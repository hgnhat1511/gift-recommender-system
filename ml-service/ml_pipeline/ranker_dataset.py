"""
ml_pipeline/ranker_dataset.py:
Xây dựng tập dữ liệu và trích xuất đặc trưng cho Ranker (Bước 7.3a).
Tuyệt đối tuân thủ tiêu chuẩn chống rò rỉ thời gian (Tiêu chí A, D, E, F):
- Mọi đặc trưng (User, Item, User-Item) CHỈ được trích xuất từ dữ liệu < cutoff.
- Bộ sinh ứng viên CandidateGenerator sinh tối đa 120 ứng viên duy nhất.
- Nhãn chính: net_cart + purchase > 0 trong cửa sổ mục tiêu 14 ngày [cutoff, cutoff + 14d).
- Mẫu âm là các ứng viên không có nhãn dương trong tập do CandidateGenerator sinh ra.
- Tỷ lệ âm:dương tối đa 30:1 (giảm mẫu âm với seed cố định = 42).
- Tối ưu hóa vector hóa hiệu năng cao.
"""

import hashlib
import time
from typing import Dict, List, Optional, Set, Tuple

import numpy as np
import pandas as pd

from ml_pipeline.data import (
    CANDIDATE_POOL_DAYS,
    TARGET_WINDOW_DAYS,
    compute_net_cart_labels,
    get_global_candidate_pool,
    split_history_and_target,
    verify_temporal_integrity,
)
from ml_pipeline.models import (
    CandidateGenerator,
    ContentBasedRecommender,
    ItemKNNRecommender,
    PopularityRecommender,
)


def extract_user_features(
    history_df: pd.DataFrame,
    cutoff: pd.Timestamp,
    user_ids: Set[int],
) -> pd.DataFrame:
    """
    Trích xuất đặc trưng người dùng (User Features) nghiêm ngặt < cutoff:
    1. user_view_count_7d, user_cart_count_7d, user_purchase_count_7d: số lượt trong 7 ngày trước cutoff.
    2. user_view_count_30d, user_cart_count_30d, user_purchase_count_30d: số lượt trong 30 ngày trước cutoff.
    3. user_view_count_all, user_cart_count_all, user_purchase_count_all: số lượt trong toàn bộ lịch sử < cutoff.
    4. user_days_since_last_event: số ngày từ sự kiện cuối cùng tới cutoff (999.0 nếu cold).
    5. user_is_warm: 1 nếu người dùng có ít nhất 1 sự kiện trong lịch sử trước cutoff, ngược lại 0.
    """
    verify_temporal_integrity(history_df, cutoff)
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    t_7d = cutoff - pd.Timedelta(days=7)
    t_30d = cutoff - pd.Timedelta(days=30)

    df_u = history_df[history_df["user_id"].isin(user_ids)].copy()

    records = {u: {
        "user_view_count_7d": 0,
        "user_cart_count_7d": 0,
        "user_purchase_count_7d": 0,
        "user_view_count_30d": 0,
        "user_cart_count_30d": 0,
        "user_purchase_count_30d": 0,
        "user_view_count_all": 0,
        "user_cart_count_all": 0,
        "user_purchase_count_all": 0,
        "user_days_since_last_event": 999.0,
        "user_is_warm": 0,
    } for u in user_ids}

    if not df_u.empty:
        # Toàn bộ lịch sử < cutoff
        counts_all = df_u.groupby(["user_id", "event_type"]).size().unstack(fill_value=0)
        v_all = counts_all.get("view", pd.Series(dtype=int)).to_dict()
        c_all = counts_all.get("cart", pd.Series(dtype=int)).to_dict()
        p_all = counts_all.get("purchase", pd.Series(dtype=int)).to_dict()
        for u in counts_all.index:
            if u in records:
                records[u]["user_view_count_all"] = int(v_all.get(u, 0))
                records[u]["user_cart_count_all"] = int(c_all.get(u, 0))
                records[u]["user_purchase_count_all"] = int(p_all.get(u, 0))
                records[u]["user_is_warm"] = 1

        # Cửa sổ 30 ngày < cutoff
        df_30d = df_u[df_u["event_time"] >= t_30d]
        if not df_30d.empty:
            counts_30d = df_30d.groupby(["user_id", "event_type"]).size().unstack(fill_value=0)
            v_30 = counts_30d.get("view", pd.Series(dtype=int)).to_dict()
            c_30 = counts_30d.get("cart", pd.Series(dtype=int)).to_dict()
            p_30 = counts_30d.get("purchase", pd.Series(dtype=int)).to_dict()
            for u in counts_30d.index:
                if u in records:
                    records[u]["user_view_count_30d"] = int(v_30.get(u, 0))
                    records[u]["user_cart_count_30d"] = int(c_30.get(u, 0))
                    records[u]["user_purchase_count_30d"] = int(p_30.get(u, 0))

        # Cửa sổ 7 ngày < cutoff
        df_7d = df_u[df_u["event_time"] >= t_7d]
        if not df_7d.empty:
            counts_7d = df_7d.groupby(["user_id", "event_type"]).size().unstack(fill_value=0)
            v_7 = counts_7d.get("view", pd.Series(dtype=int)).to_dict()
            c_7 = counts_7d.get("cart", pd.Series(dtype=int)).to_dict()
            p_7 = counts_7d.get("purchase", pd.Series(dtype=int)).to_dict()
            for u in counts_7d.index:
                if u in records:
                    records[u]["user_view_count_7d"] = int(v_7.get(u, 0))
                    records[u]["user_cart_count_7d"] = int(c_7.get(u, 0))
                    records[u]["user_purchase_count_7d"] = int(p_7.get(u, 0))

        # Số ngày từ tương tác gần nhất
        last_times = df_u.groupby("user_id")["event_time"].max()
        days_dict = ((cutoff - last_times).dt.total_seconds() / 86400.0).to_dict()
        for u, d in days_dict.items():
            if u in records:
                records[u]["user_days_since_last_event"] = float(d)

    feat_df = pd.DataFrame.from_dict(records, orient="index")
    feat_df.index.name = "user_id"
    return feat_df


def extract_item_features(
    history_df: pd.DataFrame,
    cutoff: pd.Timestamp,
    candidate_pool: Set[int],
) -> pd.DataFrame:
    """
    Trích xuất đặc trưng sản phẩm (Item Features) nghiêm ngặt < cutoff:
    1. item_pop_7d: độ phổ biến có trọng số (view 1, cart 3, purchase 5) trong 7 ngày trước cutoff.
    2. item_pop_30d: độ phổ biến có trọng số trong 30 ngày trước cutoff.
    3. item_price: giá sản phẩm (lấy từ giao dịch gần nhất trước cutoff).
    4. item_category_id: mã danh mục (lấy giá trị xuất hiện nhiều nhất trước cutoff).
    5. item_brand: thương hiệu (lấy giá trị xuất hiện nhiều nhất trước cutoff, default 'unknown').
    6. item_days_since_last_event: số ngày từ tương tác gần nhất của sản phẩm tới cutoff.
    """
    verify_temporal_integrity(history_df, cutoff)
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    t_7d = cutoff - pd.Timedelta(days=7)
    t_30d = cutoff - pd.Timedelta(days=30)

    df_items = history_df[history_df["product_id"].isin(candidate_pool)].copy()

    records = {it: {
        "item_pop_7d": 0.0,
        "item_pop_30d": 0.0,
        "item_price": 0.0,
        "item_category_id": -1,
        "item_brand": "unknown",
        "item_days_since_last_event": 999.0,
    } for it in candidate_pool}

    if not df_items.empty:
        weights = {"view": 1.0, "cart": 3.0, "purchase": 5.0}
        df_items["weight"] = df_items["event_type"].map(weights).fillna(1.0)

        # 30d popularity
        df_30d = df_items[df_items["event_time"] >= t_30d]
        if not df_30d.empty:
            pop_30 = df_30d.groupby("product_id")["weight"].sum().to_dict()
            for it, val in pop_30.items():
                if it in records:
                    records[it]["item_pop_30d"] = float(val)

        # 7d popularity
        df_7d = df_items[df_items["event_time"] >= t_7d]
        if not df_7d.empty:
            pop_7 = df_7d.groupby("product_id")["weight"].sum().to_dict()
            for it, val in pop_7.items():
                if it in records:
                    records[it]["item_pop_7d"] = float(val)

        # Metadata (Price, Category, Brand, Last event time)
        df_sorted = df_items.sort_values("event_time")
        last_rows = df_sorted.groupby("product_id").last()

        p_dict = last_rows["price"].to_dict()
        cat_dict = last_rows["category_id"].to_dict()
        br_dict = last_rows["brand"].to_dict()
        days_dict = ((cutoff - last_rows["event_time"]).dt.total_seconds() / 86400.0).to_dict()

        for it in last_rows.index:
            if it in records:
                records[it]["item_price"] = float(p_dict.get(it, 0.0))
                records[it]["item_category_id"] = int(cat_dict.get(it, -1))
                b = str(br_dict.get(it, "unknown"))
                records[it]["item_brand"] = b if b != "nan" and b.strip() else "unknown"
                records[it]["item_days_since_last_event"] = float(days_dict.get(it, 999.0))

    feat_df = pd.DataFrame.from_dict(records, orient="index")
    feat_df.index.name = "product_id"
    return feat_df


def extract_user_item_interactions(
    history_df: pd.DataFrame,
    cutoff: pd.Timestamp,
    user_ids: Set[int],
    item_metadata: pd.DataFrame,
) -> Tuple[Set[Tuple[int, int]], Set[Tuple[int, int]], Dict[Tuple[int, int], float], Dict[int, Dict[int, float]], Dict[int, Dict[str, float]]]:
    """
    Trích xuất tương tác quá khứ giữa người dùng và sản phẩm < cutoff hiệu năng cao (vectorized):
    - view_pairs: set((user_id, product_id)) đã từng view
    - cart_pairs: set((user_id, product_id)) đã từng cart
    - days_since_dict: {(user_id, product_id): days_since}
    - user_category_pref: {u: {cat_id: ratio}}
    - user_brand_pref: {u: {brand: ratio}}
    """
    verify_temporal_integrity(history_df, cutoff)
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    df_u = history_df[history_df["user_id"].isin(user_ids)].copy()

    view_pairs: Set[Tuple[int, int]] = set()
    cart_pairs: Set[Tuple[int, int]] = set()
    days_since_dict: Dict[Tuple[int, int], float] = {}
    user_category_pref: Dict[int, Dict[int, float]] = {}
    user_brand_pref: Dict[int, Dict[str, float]] = {}

    if df_u.empty:
        return view_pairs, cart_pairs, days_since_dict, user_category_pref, user_brand_pref

    # 1. Tương tác trực tiếp vectorized
    view_df = df_u[df_u["event_type"] == "view"]
    if not view_df.empty:
        view_pairs = set(zip(view_df["user_id"], view_df["product_id"]))

    cart_df = df_u[df_u["event_type"] == "cart"]
    if not cart_df.empty:
        cart_pairs = set(zip(cart_df["user_id"], cart_df["product_id"]))

    last_t = df_u.groupby(["user_id", "product_id"])["event_time"].max()
    days_since_dict = ((cutoff - last_t).dt.total_seconds() / 86400.0).to_dict()

    # 2. Phân bố sở thích danh mục
    user_cat_counts = df_u.groupby(["user_id", "category_id"]).size()
    user_totals = df_u.groupby("user_id").size()
    cat_pref_series = user_cat_counts / user_totals
    for (u, cat), r in cat_pref_series.items():
        if u not in user_category_pref:
            user_category_pref[u] = {}
        user_category_pref[u][cat] = float(r)

    # 3. Phân bố sở thích thương hiệu (bỏ qua 'unknown')
    df_valid_brand = df_u[df_u["brand"] != "unknown"]
    if not df_valid_brand.empty:
        user_brand_counts = df_valid_brand.groupby(["user_id", "brand"]).size()
        user_brand_totals = df_valid_brand.groupby("user_id").size()
        brand_pref_series = user_brand_counts / user_brand_totals
        for (u, br), r in brand_pref_series.items():
            if u not in user_brand_pref:
                user_brand_pref[u] = {}
            user_brand_pref[u][br] = float(r)

    return view_pairs, cart_pairs, days_since_dict, user_category_pref, user_brand_pref


def build_ranker_dataset_for_cutoff(
    history_df: pd.DataFrame,
    target_df: pd.DataFrame,
    cutoff: pd.Timestamp,
    candidate_pool: Set[int],
    pop_model: PopularityRecommender,
    knn_model: ItemKNNRecommender,
    cb_model: ContentBasedRecommender,
    max_users: int = 15000,
    max_neg_ratio: int = 30,
    seed: int = 42,
    downsample_negatives: bool = True,
) -> Tuple[pd.DataFrame, Dict]:
    """
    Sinh tập dữ liệu huấn luyện/validation cho Ranker tại một mốc cutoff cụ thể:
    1. Xác định ground-truth nhãn dương chính (net_cart + purchase > 0) trong 14 ngày.
    2. Lấy mẫu tối đa max_users (15.000) người dùng bằng hash md5 seed 42 nếu vượt ngưỡng.
    3. Sinh tối đa 120 ứng viên cho mỗi người dùng bằng CandidateGenerator (ItemKNN None + CBF 30 + Pop 40).
    4. Gán nhãn: y = 1 nếu ứng viên nằm trong ground-truth dương, ngược lại y = 0.
    5. Giảm mẫu âm ngẫu nhiên (seed cố định 42) nếu tỷ lệ âm:dương vượt max_neg_ratio (30:1).
       CHỈ giảm mẫu từ các ứng viên do CandidateGenerator sinh ra, không lấy âm ngoài catalog.
    6. Trích xuất và ghép nối toàn bộ 31 đặc trưng (User, Item, User-Item).
    7. Thống kê Candidate Recall và kích thước tập dữ liệu.
    """
    verify_temporal_integrity(history_df, cutoff)
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    # 1. Tính ground-truth dương
    labels_df = compute_net_cart_labels(target_df)
    pos_df = labels_df[labels_df["is_positive"]]
    gt_positives_by_user: Dict[int, Set[int]] = {}
    for u, grp in pos_df.groupby("user_id"):
        gt_positives_by_user[u] = set(grp["product_id"])

    eval_users = sorted(list(gt_positives_by_user.keys()))

    # 2. Nếu số người dùng > max_users: lấy mẫu ngẫu nhiên xác định bằng hash md5 seed 42
    if len(eval_users) > max_users:
        sampled_users = []
        for u in eval_users:
            key = f"{u}_{seed}_cutoff".encode("utf-8")
            h = int(hashlib.md5(key).hexdigest(), 16)
            sampled_users.append((h, u))
        sampled_users.sort(key=lambda x: x[0])
        eval_users = sorted([u for _, u in sampled_users[:max_users]])

    eval_users_set = set(eval_users)
    warm_users_set = set(history_df["user_id"].unique())

    # 3. Trích xuất đặc trưng người dùng và sản phẩm theo lô trước
    user_feat_df = extract_user_features(history_df, cutoff, eval_users_set)
    item_feat_df = extract_item_features(history_df, cutoff, candidate_pool)
    view_pairs, cart_pairs, days_since_dict, user_cat_pref, user_brand_pref = extract_user_item_interactions(
        history_df, cutoff, eval_users_set, item_feat_df
    )

    # Chuẩn bị danh sách phổ biến chung
    pop_recs_40 = pop_model.recommend_with_scores(0, k=40, candidate_pool=candidate_pool)
    pop_recs_50 = pop_model.recommend_with_scores(0, k=50, candidate_pool=candidate_pool)
    pop_recs_30 = pop_model.recommend_with_scores(0, k=30, candidate_pool=candidate_pool)

    rows = []
    total_pos_retrieved = 0
    total_pos_ground_truth = sum(len(gt_positives_by_user[u]) for u in eval_users)

    rng = np.random.RandomState(seed)

    for u in eval_users:
        gt_u = gt_positives_by_user[u]

        # Sinh ứng viên từ 3 kênh kèm điểm số
        if u in warm_users_set:
            k_rec = knn_model.recommend_with_scores(u, k=50, candidate_pool=candidate_pool)
            c_rec = cb_model.recommend_with_scores(u, k=30, candidate_pool=candidate_pool)
        else:
            k_rec = pop_recs_50
            c_rec = pop_recs_30
        p_rec = pop_recs_40

        k_cands = [it for it, _ in k_rec]
        c_cands = [it for it, _ in c_rec]
        p_cands = [it for it, _ in p_rec]

        k_score_dict = {it: float(s) for it, s in k_rec}
        c_score_dict = {it: float(s) for it, s in c_rec}
        p_score_dict = {it: float(s) for it, s in p_rec}

        k_rank_dict = {it: rank for rank, it in enumerate(k_cands, 1)}
        c_rank_dict = {it: rank for rank, it in enumerate(c_cands, 1)}
        p_rank_dict = {it: rank for rank, it in enumerate(p_cands, 1)}

        # Hợp nhất tối đa 120 ứng viên duy nhất theo đúng logic CandidateGenerator
        cands_ordered = []
        seen = set()
        for it in k_cands:
            if it not in seen:
                seen.add(it)
                cands_ordered.append(it)
                if len(cands_ordered) >= 50:
                    break
        for it in c_cands:
            if it not in seen:
                seen.add(it)
                cands_ordered.append(it)
                if len(cands_ordered) >= 80:
                    break
        for it in p_cands:
            if it not in seen:
                seen.add(it)
                cands_ordered.append(it)
                if len(cands_ordered) >= 120:
                    break

        user_pos_cands = [it for it in cands_ordered if it in gt_u]
        user_neg_cands = [it for it in cands_ordered if it not in gt_u]

        total_pos_retrieved += len(user_pos_cands)

        # Giảm mẫu âm nếu downsample_negatives=True (áp dụng cho tập train)
        # Tập đánh giá (val/test) giữ TOÀN BỘ ứng viên do CandidateGenerator sinh ra
        if downsample_negatives:
            max_negs = max_neg_ratio * max(1, len(user_pos_cands))
            if len(user_neg_cands) > max_negs:
                neg_indices = rng.choice(len(user_neg_cands), size=max_negs, replace=False)
                user_neg_cands = [user_neg_cands[i] for i in neg_indices]

        # Ghép đặc trưng cho từng cặp (user, candidate_item)
        selected_cands = [(it, 1) for it in user_pos_cands] + [(it, 0) for it in user_neg_cands]

        u_feat = user_feat_df.loc[u].to_dict()
        u_cats = user_cat_pref.get(u, {})
        u_brands = user_brand_pref.get(u, {})

        for it, label in selected_cands:
            it_feat = item_feat_df.loc[it].to_dict() if it in item_feat_df.index else {
                "item_pop_7d": 0.0,
                "item_pop_30d": 0.0,
                "item_price": 0.0,
                "item_category_id": -1,
                "item_brand": "unknown",
                "item_days_since_last_event": 999.0,
            }

            from_k = 1 if it in k_score_dict else 0
            from_c = 1 if it in c_score_dict else 0
            from_p = 1 if it in p_score_dict else 0

            # Ranker channel scores and ranks
            k_score = k_score_dict.get(it, 0.0)
            c_score = c_score_dict.get(it, 0.0)
            p_score = p_score_dict.get(it, 0.0)

            k_rank = k_rank_dict.get(it, 999)
            c_rank = c_rank_dict.get(it, 999)
            p_rank = p_rank_dict.get(it, 999)

            # Tương tác quá khứ
            user_viewed = 1 if (u, it) in view_pairs else 0
            user_carted = 1 if (u, it) in cart_pairs else 0
            days_since = days_since_dict.get((u, it), 999.0)

            # Match sở thích danh mục & thương hiệu
            cat_id = it_feat["item_category_id"]
            brand_str = it_feat["item_brand"]
            cat_match = u_cats.get(cat_id, 0.0)
            brand_match = u_brands.get(brand_str, 0.0) if brand_str != "unknown" else 0.0

            row = {
                "user_id": u,
                "product_id": it,
                "label": label,
                # User features (11 features)
                "user_view_count_7d": u_feat["user_view_count_7d"],
                "user_cart_count_7d": u_feat["user_cart_count_7d"],
                "user_purchase_count_7d": u_feat["user_purchase_count_7d"],
                "user_view_count_30d": u_feat["user_view_count_30d"],
                "user_cart_count_30d": u_feat["user_cart_count_30d"],
                "user_purchase_count_30d": u_feat["user_purchase_count_30d"],
                "user_view_count_all": u_feat["user_view_count_all"],
                "user_cart_count_all": u_feat["user_cart_count_all"],
                "user_purchase_count_all": u_feat["user_purchase_count_all"],
                "user_days_since_last_event": u_feat["user_days_since_last_event"],
                "user_is_warm": u_feat["user_is_warm"],
                # Item features (6 features)
                "item_pop_7d": it_feat["item_pop_7d"],
                "item_pop_30d": it_feat["item_pop_30d"],
                "item_price": it_feat["item_price"],
                "item_category_id": it_feat["item_category_id"],
                "item_brand": it_feat["item_brand"],
                "item_days_since_last_event": it_feat["item_days_since_last_event"],
                # User-Item interaction features (14 features)
                "knn_score": k_score,
                "knn_rank": k_rank,
                "cbf_score": c_score,
                "cbf_rank": c_rank,
                "pop_score": p_score,
                "pop_rank": p_rank,
                "from_knn": from_k,
                "from_cbf": from_c,
                "from_pop": from_p,
                "user_viewed_item_before": user_viewed,
                "user_carted_item_before": user_carted,
                "days_since_user_item_event": days_since,
                "category_match_user_history": cat_match,
                "brand_match_user_history": brand_match,
            }
            rows.append(row)

    dataset_df = pd.DataFrame(rows)

    candidate_recall = total_pos_retrieved / total_pos_ground_truth if total_pos_ground_truth > 0 else 0.0
    stats = {
        "cutoff": str(cutoff),
        "total_eval_users": len(eval_users),
        "total_rows": len(dataset_df),
        "positive_rows": int(dataset_df["label"].sum()) if not dataset_df.empty else 0,
        "negative_rows": int((dataset_df["label"] == 0).sum()) if not dataset_df.empty else 0,
        "neg_to_pos_ratio": (
            float((dataset_df["label"] == 0).sum() / dataset_df["label"].sum())
            if not dataset_df.empty and dataset_df["label"].sum() > 0
            else 0.0
        ),
        "total_pos_retrieved": total_pos_retrieved,
        "total_pos_ground_truth": total_pos_ground_truth,
        "candidate_recall": candidate_recall,
        "feature_count": len(dataset_df.columns) - 3 if not dataset_df.empty else 0,
        "memory_mb": float(dataset_df.memory_usage(deep=True).sum() / (1024 * 1024)) if not dataset_df.empty else 0.0,
    }

    return dataset_df, stats
