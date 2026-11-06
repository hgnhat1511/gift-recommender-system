# -*- coding: utf-8 -*-
"""
Module xây dựng, huấn luyện và đánh giá mô hình Ranker tầng 2 (LightGBM, XGBoost, RandomForest).
Bảo đảm tính bất biến, chống rò rỉ thời gian và tương thích với hệ thống đánh giá Giftly.
"""

import os
import time
import numpy as np
import pandas as pd
import lightgbm as lgb
try:
    import xgboost as xgb
except ImportError:
    xgb = None
from sklearn.ensemble import RandomForestClassifier

from ml_pipeline.evaluate import (
    ndcg_at_k,
    recall_at_k,
    precision_at_k,
    hit_rate_at_k,
    map_at_k,
    bootstrap_ci,
)

FEATURE_COLUMNS = [
    "user_view_count_7d", "user_cart_count_7d", "user_purchase_count_7d",
    "user_view_count_30d", "user_cart_count_30d", "user_purchase_count_30d",
    "user_view_count_all", "user_cart_count_all", "user_purchase_count_all",
    "user_days_since_last_event", "user_is_warm",
    "item_pop_7d", "item_pop_30d", "item_price",
    "item_category_id", "item_brand", "item_days_since_last_event",
    "knn_score", "knn_rank", "cbf_score", "cbf_rank", "pop_score", "pop_rank",
    "from_knn", "from_cbf", "from_pop",
    "user_viewed_item_before", "user_carted_item_before", "days_since_user_item_event",
    "category_match_user_history", "brand_match_user_history",
]


class CategoricalEncoder:
    """
    Bộ mã hóa categorical fit CHỈ trên tập huấn luyện train.
    Các giá trị mới ở validation hoặc test được ánh xạ về -1 (hoặc 0 đối với unknown).
    """

    def __init__(self):
        self.brand_mapping = {}
        self.cat_mapping = {}

    def fit(self, df: pd.DataFrame):
        unique_brands = sorted([b for b in df["item_brand"].dropna().unique() if b != "unknown"])
        self.brand_mapping = {b: i + 1 for i, b in enumerate(unique_brands)}
        self.brand_mapping["unknown"] = 0

        unique_cats = sorted(df["item_category_id"].dropna().unique())
        self.cat_mapping = {c: i + 1 for i, c in enumerate(unique_cats)}
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        df_out = df.copy()
        df_out["item_brand"] = df["item_brand"].map(self.brand_mapping).fillna(0).astype(np.int32)
        df_out["item_category_id"] = df["item_category_id"].map(self.cat_mapping).fillna(-1).astype(np.int32)
        return df_out


def train_ranker_model(
    model_family: str,
    config: dict,
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    train_groups: np.ndarray,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    val_groups: np.ndarray,
    random_state: int = 42,
    n_jobs: int = 4,
):
    """
    Huấn luyện mô hình Ranker theo family và cấu hình siêu tham số.
    """
    start_time = time.perf_counter()

    if model_family == "LGBMRanker":
        model = lgb.LGBMRanker(
            objective="lambdarank",
            num_leaves=config["num_leaves"],
            learning_rate=config["learning_rate"],
            n_estimators=config.get("n_estimators", 500),
            random_state=random_state,
            n_jobs=n_jobs,
            verbosity=-1,
        )
        callbacks = [lgb.early_stopping(stopping_rounds=30, verbose=False)]
        model.fit(
            X_train,
            y_train,
            group=train_groups,
            eval_set=[(X_val, y_val)],
            eval_group=[val_groups],
            eval_at=[10],
            callbacks=callbacks,
        )

    elif model_family == "LGBMClassifier":
        model = lgb.LGBMClassifier(
            objective="binary",
            num_leaves=config["num_leaves"],
            learning_rate=config["learning_rate"],
            n_estimators=config.get("n_estimators", 500),
            random_state=random_state,
            n_jobs=n_jobs,
            verbosity=-1,
        )
        callbacks = [lgb.early_stopping(stopping_rounds=30, verbose=False)]
        model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            callbacks=callbacks,
        )

    elif model_family == "XGBClassifier":
        model = xgb.XGBClassifier(
            objective="binary:logistic",
            max_depth=config["max_depth"],
            learning_rate=config["learning_rate"],
            n_estimators=config.get("n_estimators", 500),
            tree_method="hist",
            early_stopping_rounds=30,
            eval_metric="logloss",
            random_state=random_state,
            n_jobs=n_jobs,
            verbosity=0,
        )
        model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

    elif model_family == "RandomForest":
        model = RandomForestClassifier(
            max_depth=config["max_depth"],
            min_samples_leaf=config["min_samples_leaf"],
            n_estimators=config.get("n_estimators", 200),
            random_state=random_state,
            n_jobs=n_jobs,
        )
        model.fit(X_train, y_train)

    else:
        raise ValueError(f"Unknown model_family: {model_family}")

    fit_time = time.perf_counter() - start_time
    return model, fit_time


def predict_ranker_scores(model, model_family: str, X: pd.DataFrame) -> np.ndarray:
    """
    Dự đoán điểm xếp hạng từ mô hình.
    """
    if model_family in ("LGBMRanker",):
        return model.predict(X)
    elif model_family in ("LGBMClassifier", "XGBClassifier", "RandomForest"):
        if hasattr(model, "predict_proba"):
            return model.predict_proba(X)[:, 1]
        return model.predict(X)
    else:
        return model.predict(X)


def evaluate_ranker_on_validation(
    val_df: pd.DataFrame,
    pred_scores: np.ndarray,
    gt_primary: dict,
    gt_purchase: dict,
    warm_def1_users: set,
    cold_def1_users: set,
    warm_def2_users: set,
    cold_def2_users: set,
    k: int = 10,
) -> dict:
    """
    Đánh giá kết quả dự đoán của Ranker trên toàn bộ người dùng validation.
    """
    eval_df = val_df[["user_id", "product_id"]].copy()
    eval_df["score"] = pred_scores

    # Sắp xếp theo user_id tăng dần, score giảm dần, product_id tăng dần (ổn định tie-breaking)
    eval_df = eval_df.sort_values(
        by=["user_id", "score", "product_id"],
        ascending=[True, False, True],
    )

    top_k_df = eval_df.groupby("user_id").head(k)
    recs_by_user = top_k_df.groupby("user_id")["product_id"].apply(list).to_dict()

    all_users = list(gt_primary.keys())
    purchase_users = [u for u in all_users if u in gt_purchase and len(gt_purchase[u]) > 0]

    def _calc_metrics(user_list, ground_truth_dict):
        ndcgs, recalls, precs, hits, maps = [], [], [], [], []
        user_ndcgs = {}
        for u in user_list:
            recs = recs_by_user.get(u, [])
            gt = ground_truth_dict.get(u, set())
            ndcg_val = ndcg_at_k(gt, recs, k=k)
            ndcgs.append(ndcg_val)
            user_ndcgs[u] = ndcg_val
            recalls.append(recall_at_k(gt, recs, k=k))
            precs.append(precision_at_k(gt, recs, k=k))
            hits.append(hit_rate_at_k(gt, recs, k=k))
            maps.append(map_at_k(gt, recs, k=k))

        return {
            f"ndcg@{k}": float(np.mean(ndcgs)),
            f"recall@{k}": float(np.mean(recalls)),
            f"precision@{k}": float(np.mean(precs)),
            f"hit_rate@{k}": float(np.mean(hits)),
            f"map@{k}": float(np.mean(maps)),
            "user_ndcgs": user_ndcgs,
        }

    # Đánh giá toàn bộ
    res_primary = _calc_metrics(all_users, gt_primary)
    res_purchase = _calc_metrics(purchase_users, gt_purchase)

    # Phân đoạn Warm vs Cold
    w1_users = [u for u in all_users if u in warm_def1_users]
    c1_users = [u for u in all_users if u in cold_def1_users]
    w2_users = [u for u in all_users if u in warm_def2_users]
    c2_users = [u for u in all_users if u in cold_def2_users]

    res_w1 = _calc_metrics(w1_users, gt_primary)
    res_c1 = _calc_metrics(c1_users, gt_primary)
    res_w2 = _calc_metrics(w2_users, gt_primary)
    res_c2 = _calc_metrics(c2_users, gt_primary)

    # Đếm số danh sách top-10 khác nhau ở Cold Def 1
    cold_def1_lists = [tuple(recs_by_user.get(u, [])) for u in c1_users]
    unique_cold_recs_count = len(set(cold_def1_lists))

    return {
        "primary_all": {k_m: res_primary[k_m] for k_m in [f"ndcg@{k}", f"recall@{k}", f"precision@{k}", f"hit_rate@{k}", f"map@{k}"]},
        "purchase_only": {k_m: res_purchase[k_m] for k_m in [f"ndcg@{k}", f"recall@{k}", f"precision@{k}", f"hit_rate@{k}", f"map@{k}"]},
        "warm_def1": {k_m: res_w1[k_m] for k_m in [f"ndcg@{k}", f"recall@{k}", f"precision@{k}", f"hit_rate@{k}", f"map@{k}"]},
        "cold_def1": {k_m: res_c1[k_m] for k_m in [f"ndcg@{k}", f"recall@{k}", f"precision@{k}", f"hit_rate@{k}", f"map@{k}"]},
        "warm_def2": {k_m: res_w2[k_m] for k_m in [f"ndcg@{k}", f"recall@{k}", f"precision@{k}", f"hit_rate@{k}", f"map@{k}"]},
        "cold_def2": {k_m: res_c2[k_m] for k_m in [f"ndcg@{k}", f"recall@{k}", f"precision@{k}", f"hit_rate@{k}", f"map@{k}"]},
        "cold_def1_unique_recommendations_count": unique_cold_recs_count,
        "primary_user_ndcgs": res_primary["user_ndcgs"],
        "recs_by_user": recs_by_user,
    }
