# -*- coding: utf-8 -*-
"""
Dịch vụ phục vụ xếp hạng thời gian thực (Online Serving) bằng mô hình Ranker LC-1.
Tái sử dụng đúng định nghĩa FEATURE_COLUMNS và CategoricalEncoder từ pipeline huấn luyện.
"""

import hashlib
import os
import pickle
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from ml_pipeline.ranker import FEATURE_COLUMNS, CategoricalEncoder


class RankerService:
    def __init__(
        self,
        model_path: str = "models/ranker_best_model.pkl",
        data_path: str = "data/processed/ranker_val_full.parquet",
    ):
        self.model_path = model_path
        self.data_path = data_path

        # 1. Kiểm tra và tính mã SHA-256 của artifact mô hình
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model artifact not found at {model_path}")
        with open(model_path, "rb") as f:
            raw_bytes = f.read()
            self.model_sha256 = hashlib.sha256(raw_bytes).hexdigest()

        # 2. Nạp artifact mô hình
        with open(model_path, "rb") as f:
            artifact = pickle.load(f)
        self.model = artifact["model"]
        self.encoder: CategoricalEncoder = artifact["encoder"]
        self.feature_columns = artifact.get("feature_columns", FEATURE_COLUMNS)
        self.model_version = artifact.get("config_id", "LC-1")

        # 3. Nạp dữ liệu phục vụ tra cứu
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"Serving data not found at {data_path}")
        self.val_df = pd.read_parquet(data_path)

        # Tiền nhóm theo user_id để tra cứu O(1) tức thì
        self.user_groups: Dict[int, pd.DataFrame] = {
            int(u): group for u, group in self.val_df.groupby("user_id")
        }

        # Bảng tra cứu độ phổ biến thật từ item_pop_30d của sản phẩm
        unique_items = self.val_df.drop_duplicates(subset=["product_id"]).sort_values(
            by="item_pop_30d", ascending=False
        )
        self.item_pop_map: Dict[int, float] = dict(
            zip(unique_items["product_id"].astype(int), unique_items["item_pop_30d"].astype(float))
        )
        self.known_product_ids = set(self.item_pop_map.keys())
        self.fallback_popular_items: List[int] = unique_items["product_id"].astype(int).tolist()
        self.candidate_pool_size = len(self.known_product_ids)

    def rank(
        self,
        user_id: Optional[int],
        top_k: int = 10,
        candidate_ids: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """
        Chấm điểm và xếp hạng danh sách ứng viên cho một người dùng.
        - Nếu candidate_ids được truyền vào nhưng không có ID nào thuộc pool mô hình:
          trả source='unknown_candidates', items=[], total_candidates=0.
        - Nếu user cold hoặc không có trong dữ liệu lịch sử:
          trả popularity_fallback xếp theo độ phổ biến thật (item_pop_30d).
        - Nếu user có lịch sử (warm) và có ứng viên thuộc pool:
          chấm điểm qua mô hình Ranker LC-1, trả source='ranker_lc1'.
        """
        # 1. Kiểm tra tập ứng viên truyền vào (nếu có)
        filtered_cands: Optional[List[int]] = None
        if candidate_ids is not None and len(candidate_ids) > 0:
            filtered_cands = [cid for cid in candidate_ids if int(cid) in self.known_product_ids]
            if len(filtered_cands) == 0:
                # Không có candidate_id nào nằm trong pool mô hình
                return {
                    "success": True,
                    "user_id": user_id,
                    "source": "unknown_candidates",
                    "model_version": self.model_version,
                    "total_candidates": 0,
                    "items": [],
                }

        # 2. Kiểm tra người dùng có lịch sử không
        if user_id is None or int(user_id) not in self.user_groups:
            return self._fallback_popularity(user_id, top_k, filtered_cands)

        u_rows = self.user_groups[int(user_id)]

        # Lọc theo danh sách ứng viên hợp lệ
        if filtered_cands is not None:
            cand_set = set(int(cid) for cid in filtered_cands)
            u_rows = u_rows[u_rows["product_id"].isin(cand_set)]
            if u_rows.empty:
                # User có trong tập nhưng các candidate truyền vào không nằm trong tập ứng viên của user
                return self._fallback_popularity(user_id, top_k, filtered_cands)

        u_rows = u_rows.copy()

        # 3. Mã hóa đặc trưng qua CategoricalEncoder từ pipeline huấn luyện
        u_enc = self.encoder.transform(u_rows)

        # 4. Chấm điểm xác suất qua mô hình LightGBM LC-1
        scores = self.model.predict_proba(u_enc[self.feature_columns])[:, 1]
        u_rows["score"] = scores

        # 5. Sắp xếp ổn định (score giảm dần, product_id tăng dần khi tie)
        u_sorted = u_rows.sort_values(by=["score", "product_id"], ascending=[False, True])
        top_slice = u_sorted.head(top_k)

        # 6. Sinh lý do gợi ý trực quan
        items = []
        for _, row in top_slice.iterrows():
            reasons = self._generate_reasons(row)
            items.append({
                "id": int(row["product_id"]),
                "score": float(round(float(row["score"]), 6)),
                "reasons": reasons,
            })

        return {
            "success": True,
            "user_id": user_id,
            "source": "ranker_lc1",
            "model_version": self.model_version,
            "total_candidates": len(u_rows),
            "items": items,
        }

    def _fallback_popularity(
        self,
        user_id: Optional[int],
        top_k: int = 10,
        candidate_ids: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """
        Phương án dự phòng cho người dùng mới hoàn toàn (cold-start) hoặc không đủ lịch sử.
        Sắp xếp theo độ phổ biến thật (item_pop_30d DESC), không theo thứ tự đầu vào.
        KHÔNG tạo điểm giả 1/(idx+1).
        """
        if candidate_ids is not None and len(candidate_ids) > 0:
            seen = set()
            pool = []
            for cid in candidate_ids:
                icid = int(cid)
                if icid in self.known_product_ids and icid not in seen:
                    seen.add(icid)
                    pool.append(icid)
            if not pool:
                return {
                    "success": True,
                    "user_id": user_id,
                    "source": "unknown_candidates",
                    "model_version": self.model_version,
                    "total_candidates": 0,
                    "items": [],
                }
            # Sắp xếp theo độ phổ biến thật item_pop_30d giảm dần, tie breaker bằng product_id tăng dần
            pool.sort(key=lambda pid: (-self.item_pop_map.get(pid, 0.0), pid))
        else:
            pool = self.fallback_popular_items

        top_pool = pool[:top_k]
        items = [
            {
                "id": int(pid),
                "score": float(round(float(self.item_pop_map.get(pid, 0.0)), 6)),
                "reasons": ["Sản phẩm thịnh hành có lượt tương tác cao"],
            }
            for pid in top_pool
        ]

        return {
            "success": True,
            "user_id": user_id,
            "source": "popularity_fallback",
            "model_version": self.model_version,
            "total_candidates": len(pool),
            "items": items,
        }

    def _generate_reasons(self, row: pd.Series) -> List[str]:
        reasons = []

        # 1. Kênh sinh ứng viên
        if row.get("from_knn") == 1:
            rank_val = int(row.get("knn_rank", 999))
            reasons.append(f"Gợi ý từ tương quan ItemKNN (Hạng #{rank_val})")
        elif row.get("from_cbf") == 1:
            rank_val = int(row.get("cbf_rank", 999))
            reasons.append(f"Phù hợp thuộc tính Content-Based (Hạng #{rank_val})")
        elif row.get("from_pop") == 1:
            rank_val = int(row.get("pop_rank", 999))
            reasons.append(f"Món quà thịnh hành (Hạng #{rank_val})")

        # 2. Lịch sử tương tác
        if row.get("user_carted_item_before") == 1:
            reasons.append("Bạn đã từng thêm vào giỏ hàng")
        elif row.get("user_viewed_item_before") == 1:
            reasons.append("Bạn đã từng xem sản phẩm này")

        # 3. Độ tươi mới
        recency = float(row.get("days_since_user_item_event", 999.0))
        if recency < 90:
            reasons.append(f"Tương tác gần đây ({recency:.1f} ngày trước)")

        # 4. Độ khớp sở thích
        if float(row.get("category_match_user_history", 0)) > 0:
            reasons.append("Phù hợp danh mục bạn thường quan tâm")
        if float(row.get("brand_match_user_history", 0)) > 0:
            reasons.append("Thương hiệu phù hợp sở thích")

        if not reasons:
            reasons.append("Được hệ thống xếp hạng tối ưu cho bạn")

        return reasons
