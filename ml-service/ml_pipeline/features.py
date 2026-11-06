"""
Module trích xuất đặc trưng (Feature Engineering) cho bài toán Re-ranking.
Tuân thủ nghiêm ngặt:
- Tiêu chí A: Không rò rỉ thời gian (Temporal Leakage Guard).
- Tiêu chí D: Không dùng category_code (chỉ dùng category_id, brand, price).
"""

from typing import Dict, List, Optional, Tuple, Set
import numpy as np
import pandas as pd

from ml_pipeline.data import verify_temporal_integrity


def build_user_features(history_df: pd.DataFrame, cutoff: pd.Timestamp) -> pd.DataFrame:
    """
    Trích xuất đặc trưng phía Người dùng (User Features) từ lịch sử trước cutoff.
    """
    verify_temporal_integrity(history_df, cutoff)

    if history_df.empty:
        return pd.DataFrame()

    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    events = history_df.copy()
    if not pd.api.types.is_datetime64_any_dtype(events["event_time"]):
        events["event_time"] = pd.to_datetime(events["event_time"], utc=True)
    elif events["event_time"].dt.tz is None:
        events["event_time"] = events["event_time"].dt.tz_localize("UTC")

    # Giới hạn 30 ngày trước cutoff
    start_30d = cutoff - pd.Timedelta(days=30)
    events_30d = events[events["event_time"] >= start_30d]

    start_14d = cutoff - pd.Timedelta(days=14)
    start_7d = cutoff - pd.Timedelta(days=7)

    # 1. Tương tác trong 30d, 14d, 7d
    user_counts_30d = events_30d.groupby(["user_id", "event_type"]).size().unstack(fill_value=0)
    for col in ["view", "cart", "purchase", "remove_from_cart"]:
        if col not in user_counts_30d.columns:
            user_counts_30d[col] = 0

    user_counts_30d = user_counts_30d.rename(
        columns={
            "view": "u_view_30d",
            "cart": "u_cart_30d",
            "purchase": "u_purchase_30d",
            "remove_from_cart": "u_remove_30d",
        }
    )
    user_counts_30d["u_total_30d"] = (
        user_counts_30d["u_view_30d"] + user_counts_30d["u_cart_30d"] + user_counts_30d["u_purchase_30d"]
    )

    # 14d
    events_14d = events_30d[events_30d["event_time"] >= start_14d]
    u_14d = events_14d.groupby(["user_id", "event_type"]).size().unstack(fill_value=0)
    for col in ["view", "cart", "purchase"]:
        if col not in u_14d.columns:
            u_14d[col] = 0
    u_14d = u_14d[["view", "cart", "purchase"]].rename(
        columns={"view": "u_view_14d", "cart": "u_cart_14d", "purchase": "u_purchase_14d"}
    )

    # 7d
    events_7d = events_30d[events_30d["event_time"] >= start_7d]
    u_7d = events_7d.groupby(["user_id", "event_type"]).size().unstack(fill_value=0)
    for col in ["view", "cart", "purchase"]:
        if col not in u_7d.columns:
            u_7d[col] = 0
    u_7d = u_7d[["view", "cart", "purchase"]].rename(
        columns={"view": "u_view_7d", "cart": "u_cart_7d", "purchase": "u_purchase_7d"}
    )

    # 2. Giá trị đơn hàng / tương tác giá
    u_price = events_30d.groupby("user_id")["price"].agg(
        u_avg_price="mean", u_min_price="min", u_max_price="max", u_std_price="std"
    ).fillna(0)

    # 3. Recency (số ngày kể từ tương tác cuối tới cutoff)
    u_last_time = events_30d.groupby("user_id")["event_time"].max()
    u_recency = (cutoff - u_last_time).dt.total_seconds() / 86400.0
    u_recency = u_recency.rename("u_recency_days")

    # 4. Đa dạng danh mục & thương hiệu
    u_diversity = events_30d.groupby("user_id").agg(
        u_unique_categories=("category_id", "nunique"),
        u_unique_brands=("brand", "nunique"),
    )

    # Ghép lại
    user_feats = (
        user_counts_30d.join(u_14d, how="left")
        .join(u_7d, how="left")
        .join(u_price, how="left")
        .join(u_recency, how="left")
        .join(u_diversity, how="left")
        .fillna(0)
    )

    # Tỷ lệ chuyển đổi người dùng
    user_feats["u_cart_to_view_ratio"] = user_feats["u_cart_30d"] / (user_feats["u_view_30d"] + 1e-4)
    user_feats["u_purchase_to_cart_ratio"] = user_feats["u_purchase_30d"] / (user_feats["u_cart_30d"] + 1e-4)
    user_feats["u_net_cart_30d"] = np.maximum(0, user_feats["u_cart_30d"] - user_feats["u_remove_30d"])

    return user_feats.reset_index()


def build_item_features(history_df: pd.DataFrame, cutoff: pd.Timestamp) -> pd.DataFrame:
    """
    Trích xuất đặc trưng phía Sản phẩm (Item Features) từ lịch sử trước cutoff.
    Tiêu chí D: Chỉ dùng category_id, brand, price (loại bỏ category_code).
    """
    verify_temporal_integrity(history_df, cutoff)

    if history_df.empty:
        return pd.DataFrame()

    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    events = history_df.copy()
    if not pd.api.types.is_datetime64_any_dtype(events["event_time"]):
        events["event_time"] = pd.to_datetime(events["event_time"], utc=True)
    elif events["event_time"].dt.tz is None:
        events["event_time"] = events["event_time"].dt.tz_localize("UTC")

    # Thông tin tĩnh mới nhất của sản phẩm
    latest_item_info = (
        events.sort_values("event_time")
        .groupby("product_id")
        .last()[["category_id", "brand", "price"]]
        .reset_index()
    )

    # Giới hạn 30 ngày trước cutoff cho các chỉ số động
    start_30d = cutoff - pd.Timedelta(days=30)
    events_30d = events[events["event_time"] >= start_30d]

    start_14d = cutoff - pd.Timedelta(days=14)
    start_7d = cutoff - pd.Timedelta(days=7)

    # 1. Đếm tương tác 30d
    item_counts_30d = events_30d.groupby(["product_id", "event_type"]).size().unstack(fill_value=0)
    for col in ["view", "cart", "purchase", "remove_from_cart"]:
        if col not in item_counts_30d.columns:
            item_counts_30d[col] = 0

    item_counts_30d = item_counts_30d.rename(
        columns={
            "view": "i_view_30d",
            "cart": "i_cart_30d",
            "purchase": "i_purchase_30d",
            "remove_from_cart": "i_remove_30d",
        }
    )
    item_counts_30d["i_total_30d"] = (
        item_counts_30d["i_view_30d"] + item_counts_30d["i_cart_30d"] + item_counts_30d["i_purchase_30d"]
    )

    # 14d
    events_14d = events_30d[events_30d["event_time"] >= start_14d]
    i_14d = events_14d.groupby(["product_id", "event_type"]).size().unstack(fill_value=0)
    for col in ["view", "cart", "purchase"]:
        if col not in i_14d.columns:
            i_14d[col] = 0
    i_14d = i_14d[["view", "cart", "purchase"]].rename(
        columns={"view": "i_view_14d", "cart": "i_cart_14d", "purchase": "i_purchase_14d"}
    )

    # 7d
    events_7d = events_30d[events_30d["event_time"] >= start_7d]
    i_7d = events_7d.groupby(["product_id", "event_type"]).size().unstack(fill_value=0)
    for col in ["view", "cart", "purchase"]:
        if col not in i_7d.columns:
            i_7d[col] = 0
    i_7d = i_7d[["view", "cart", "purchase"]].rename(
        columns={"view": "i_view_7d", "cart": "i_cart_7d", "purchase": "i_purchase_7d"}
    )

    # 2. Recency
    i_last_time = events_30d.groupby("product_id")["event_time"].max()
    i_recency = (cutoff - i_last_time).dt.total_seconds() / 86400.0
    i_recency = i_recency.rename("i_recency_days")

    # 3. Unique users
    i_users = events_30d.groupby("product_id")["user_id"].nunique().rename("i_unique_users_30d")

    # Ghép các chỉ số
    item_feats = (
        latest_item_info.set_index("product_id")
        .join(item_counts_30d, how="left")
        .join(i_14d, how="left")
        .join(i_7d, how="left")
        .join(i_recency, how="left")
        .join(i_users, how="left")
        .fillna(0)
    )

    # Conversion rate
    item_feats["i_conversion_rate_30d"] = item_feats["i_purchase_30d"] / (item_feats["i_view_30d"] + 1e-4)
    item_feats["i_cart_rate_30d"] = item_feats["i_cart_30d"] / (item_feats["i_view_30d"] + 1e-4)

    # Price bins (quantile / buckets)
    # Buckets: 0-10, 10-25, 25-50, 50-100, 100+
    bins = [0, 10, 25, 50, 100, float("inf")]
    labels = [0, 1, 2, 3, 4]
    item_feats["price_bin"] = pd.cut(item_feats["price"], bins=bins, labels=labels, right=False).astype(float).fillna(0)

    # Relative price to category average
    cat_avg_price = item_feats.groupby("category_id")["price"].transform("mean")
    item_feats["i_price_vs_cat_mean"] = item_feats["price"] / (cat_avg_price + 1e-4)

    return item_feats.reset_index()


def build_user_item_features(
    user_item_pairs: pd.DataFrame,
    history_df: pd.DataFrame,
    cutoff: pd.Timestamp,
    user_feats_df: Optional[pd.DataFrame] = None,
    item_feats_df: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """
    Trích xuất đặc trưng Tương tác Người dùng - Sản phẩm (User-Item Interaction Features):
    - ui_view_count, ui_cart_count, ui_purchase_count trong 30d
    - ui_recency_days
    - Chênh lệch giá giữa item và user average price
    """
    verify_temporal_integrity(history_df, cutoff)

    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    events = history_df.copy()
    if not pd.api.types.is_datetime64_any_dtype(events["event_time"]):
        events["event_time"] = pd.to_datetime(events["event_time"], utc=True)
    elif events["event_time"].dt.tz is None:
        events["event_time"] = events["event_time"].dt.tz_localize("UTC")

    # Giới hạn 30 ngày trước cutoff
    start_30d = cutoff - pd.Timedelta(days=30)
    events_30d = events[events["event_time"] >= start_30d]

    # Tính tương tác lịch sử trực tiếp của cặp (user_id, product_id)
    ui_agg = (
        events_30d.groupby(["user_id", "product_id", "event_type"])
        .size()
        .unstack(fill_value=0)
        .reset_index()
    )
    for col in ["view", "cart", "purchase"]:
        if col not in ui_agg.columns:
            ui_agg[col] = 0

    ui_agg = ui_agg.rename(
        columns={"view": "ui_view_30d", "cart": "ui_cart_30d", "purchase": "ui_purchase_30d"}
    )
    ui_agg["ui_total_30d"] = ui_agg["ui_view_30d"] + ui_agg["ui_cart_30d"] + ui_agg["ui_purchase_30d"]

    # UI recency
    ui_last = events_30d.groupby(["user_id", "product_id"])["event_time"].max().reset_index()
    ui_last["ui_recency_days"] = (cutoff - ui_last["event_time"]).dt.total_seconds() / 86400.0
    ui_agg = pd.merge(ui_agg, ui_last[["user_id", "product_id", "ui_recency_days"]], on=["user_id", "product_id"], how="left")

    # Merge với cặp (user_id, product_id) đầu vào
    merged = pd.merge(user_item_pairs, ui_agg, on=["user_id", "product_id"], how="left")
    fill_zeros = ["ui_view_30d", "ui_cart_30d", "ui_purchase_30d", "ui_total_30d"]
    for c in fill_zeros:
        if c in merged.columns:
            merged[c] = merged[c].fillna(0)
    if "ui_recency_days" in merged.columns:
        merged["ui_recency_days"] = merged["ui_recency_days"].fillna(999.0)

    # Ghép thêm user features và item features nếu có
    if user_feats_df is not None:
        merged = pd.merge(merged, user_feats_df, on="user_id", how="left")
    if item_feats_df is not None:
        merged = pd.merge(merged, item_feats_df, on="product_id", how="left")

    # Feature chênh lệch giá
    if "price" in merged.columns and "u_avg_price" in merged.columns:
        merged["ui_price_diff_ratio"] = (merged["price"] - merged["u_avg_price"]) / (merged["u_avg_price"] + 1e-4)

    return merged
