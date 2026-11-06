# -*- coding: utf-8 -*-
"""
Kiểm thử tính tương đương (Parity Test) giữa Chấm điểm Online qua FastAPI và Chấm điểm Offline (Bước 2).
Yêu cầu: Với 50 người dùng mẫu từ tập validation, sai số điểm số tuyệt đối phải < 1e-6.
Chứng minh không có hiện tượng lệch phân phối Train/Serve (No Train/Serve Skew).
Không yêu cầu cài thêm thư viện bên ngoài (dùng trực tiếp endpoint và urllib).
"""

import pickle
import numpy as np
import pandas as pd
import pytest

from main import app, health, recommend_rank, RankRequest, init_service
from ml_pipeline.ranker import FEATURE_COLUMNS

EXPECTED_SHA256 = "1d11488782894eae3b4eb142943303f4c9e85d0784f800047396d4f444eea8ff"


@pytest.fixture(scope="module", autouse=True)
def setup_service():
    """
    Khởi tạo ranker_service trước khi chạy tests.
    """
    init_service()
    yield


def test_health_endpoint():
    """
    Kiểm tra endpoint /health trả về đúng version mô hình và SHA-256 đã khóa.
    """
    data = health()
    assert data["status"] == "healthy"
    assert data["modelVersion"] == "LC-1"
    assert data["modelSha256"] == EXPECTED_SHA256
    assert data["totalUsersLoaded"] > 0
    assert data["candidatePoolSize"] > 0


def test_cold_user_fallback():
    """
    Kiểm tra người dùng cold / chưa từng có trong lịch sử được fallback về Popularity.
    """
    req = RankRequest(user_id=999999999, top_k=10)
    data = recommend_rank(req)
    assert data["success"] is True
    assert data["source"] == "popularity_fallback"
    assert len(data["items"]) == 10
    assert all("thịnh hành" in reason for item in data["items"] for reason in item["reasons"])


def test_unknown_candidates_returns_unknown_source():
    """
    Khi danh sách candidate_ids không có bất kỳ ID nào thuộc pool mô hình,
    FastAPI phải trả source='unknown_candidates', items=[], total_candidates=0.
    Tuyệt đối không tạo điểm giả 1/(idx+1).
    """
    # [1, 2, 3] là các ID catalog MySQL cũ, hoàn toàn không nằm trong REES46 pool
    req = RankRequest(user_id=999999999, top_k=10, candidate_ids=[1, 2, 3])
    data = recommend_rank(req)
    assert data["success"] is True
    assert data["source"] == "unknown_candidates"
    assert data["total_candidates"] == 0
    assert len(data["items"]) == 0


def test_cold_user_with_known_candidates_sorts_by_pop():
    """
    Người dùng cold nhưng tập candidate_ids chứa các ID đã biết trong pool:
    Phải trả source='popularity_fallback', sắp xếp giảm dần theo độ phổ biến thật (item_pop_30d).
    """
    srv = init_service()
    known_two = list(srv.known_product_ids)[:2]
    # Đảo ngược thứ tự đầu vào để kiểm tra việc sắp xếp theo độ phổ biến
    pop_0 = srv.item_pop_map[known_two[0]]
    pop_1 = srv.item_pop_map[known_two[1]]
    req = RankRequest(user_id=999999999, top_k=2, candidate_ids=[known_two[0], known_two[1]])
    data = recommend_rank(req)
    assert data["success"] is True
    assert data["source"] == "popularity_fallback"
    assert len(data["items"]) == 2
    if pop_0 > pop_1:
        assert data["items"][0]["id"] == known_two[0]
        assert data["items"][1]["id"] == known_two[1]
    elif pop_1 > pop_0:
        assert data["items"][0]["id"] == known_two[1]
        assert data["items"][1]["id"] == known_two[0]
    # Điểm số là item_pop_30d thật, không phải 1.0 hay 0.5 giả
    assert data["items"][0]["score"] == float(round(max(pop_0, pop_1), 6))


def test_validation_parity_50_users():
    """
    [TIÊU CHÍ 2 - PARITY TEST]:
    Lấy mẫu 50 người dùng từ tập validation (ranker_val_full.parquet).
    So sánh điểm số trả về từ API /recommend/rank với điểm số tính toán offline trực tiếp.
    Yêu cầu: max |score_api - score_offline| < 1e-6 trên toàn bộ các cặp ứng viên.
    """
    # 1. Nạp dữ liệu offline và mô hình đóng băng
    val_df = pd.read_parquet("data/processed/ranker_val_full.parquet")
    with open("models/ranker_best_model.pkl", "rb") as f:
        artifact = pickle.load(f)
    model = artifact["model"]
    encoder = artifact["encoder"]
    cols = artifact.get("feature_columns", FEATURE_COLUMNS)

    # 2. Chọn 50 người dùng mẫu đầu tiên
    sample_users = val_df["user_id"].unique()[:50]
    assert len(sample_users) == 50, "Cần đủ 50 người dùng mẫu"

    max_diff = 0.0
    total_pairs_checked = 0

    for u in sample_users:
        u_rows = val_df[val_df["user_id"] == u].copy()
        cands = [int(p) for p in u_rows["product_id"].tolist()]

        # Tính điểm offline trực tiếp qua pipeline huấn luyện
        u_enc = encoder.transform(u_rows)
        offline_scores = model.predict_proba(u_enc[cols])[:, 1]
        offline_dict = {int(p): float(s) for p, s in zip(cands, offline_scores)}

        # Gọi endpoint online
        req = RankRequest(
            user_id=int(u),
            top_k=len(cands),
            candidate_ids=cands,
        )
        res_data = recommend_rank(req)
        assert res_data["success"] is True
        assert res_data["source"] == "ranker_lc1"

        api_dict = {item["id"]: item["score"] for item in res_data["items"]}

        # So sánh từng ứng viên
        for p_id, off_score in offline_dict.items():
            assert p_id in api_dict, f"Ứng viên {p_id} bị thiếu trong kết quả API"
            api_score = api_dict[p_id]
            diff = abs(off_score - api_score)
            if diff > max_diff:
                max_diff = diff
            total_pairs_checked += 1

    print(f"\n[PARITY AUDIT] Checked 50 users, total {total_pairs_checked} candidate pairs.")
    print(f"[PARITY AUDIT] Max absolute score difference: {max_diff:.2e}")
    assert max_diff < 1e-6, f"Difference {max_diff} exceeds 1e-6 threshold!"
