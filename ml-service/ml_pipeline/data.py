"""
Module xử lý và phân tách dữ liệu (Data Loading, Sampling & Splitting).
Tuân thủ nghiêm ngặt các tiêu chí A, B, C, D của Giai đoạn 7.
"""

import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Set

import numpy as np
import pandas as pd


# 1. Cấu hình các mốc cắt thời gian (Cutoffs) và Cửa sổ mục tiêu (14 ngày)
TRAIN_CUTOFFS: List[str] = [
    "2019-11-01 00:00:00",
    "2019-11-15 00:00:00",
    "2019-12-01 00:00:00",
    "2019-12-15 00:00:00",
    "2020-01-01 00:00:00",
]

VALIDATION_CUTOFF: str = "2020-01-15 00:00:00"

TEST_CUTOFF_1: str = "2020-02-01 00:00:00"
TEST_CUTOFF_2: str = "2020-02-15 00:00:00"

TARGET_WINDOW_DAYS: int = 14
CANDIDATE_POOL_DAYS: int = 30


def hash_sample_user(user_id: int, sample_ratio: float = 0.1, seed: int = 42) -> bool:
    """
    Kiểm tra xem user_id có thuộc mẫu ngẫu nhiên hay không bằng hàm băm md5 xác định.
    Tiêu chí C: hash(user_id) % 100 với cố định seed = 42.
    """
    key = f"{user_id}_{seed}".encode("utf-8")
    hash_val = int(hashlib.md5(key).hexdigest(), 16) % 10000
    threshold = int(sample_ratio * 10000)
    return hash_val < threshold


def clean_events(df: pd.DataFrame) -> pd.DataFrame:
    """
    Tiền xử lý và làm sạch dữ liệu sự kiện:
    - Điền brand còn thiếu bằng 'unknown'
    - Lọc bỏ sản phẩm có giá <= 0
    - Ép kiểu event_time sang datetime UTC
    - Loại bỏ các bản ghi trùng lặp hoàn toàn
    """
    df = df.copy()
    if not pd.api.types.is_datetime64_any_dtype(df["event_time"]):
        df["event_time"] = pd.to_datetime(df["event_time"], utc=True)
    elif df["event_time"].dt.tz is None:
        df["event_time"] = df["event_time"].dt.tz_localize("UTC")

    # Điền missing
    if "brand" in df.columns:
        df["brand"] = df["brand"].fillna("unknown").astype(str)
    if "category_code" in df.columns:
        df["category_code"] = df["category_code"].fillna("unknown").astype(str)

    # Lọc giá hợp lệ
    if "price" in df.columns:
        df = df[df["price"] > 0]

    # Loại bỏ duplicate sự kiện trùng khớp
    dedup_cols = ["event_time", "event_type", "product_id", "user_id"]
    existing_cols = [c for c in dedup_cols if c in df.columns]
    if existing_cols:
        df = df.drop_duplicates(subset=existing_cols)

    return df


def compute_net_cart_labels(window_df: pd.DataFrame) -> pd.DataFrame:
    """
    Tính nhãn người dùng - sản phẩm trong cửa sổ mục tiêu (Tiêu chí B):
    net_cart = count(cart) - count(remove_from_cart) > 0
    positive_label = (purchase > 0) | (net_cart > 0)
    purchase_only_label = (purchase > 0)
    """
    if window_df.empty:
        return pd.DataFrame(
            columns=["user_id", "product_id", "purchase_count", "net_cart_count", "is_positive", "is_purchase"]
        )

    # Đếm số lần cho từng loại sự kiện theo cặp (user_id, product_id)
    agg_df = (
        window_df.groupby(["user_id", "product_id", "event_type"])
        .size()
        .unstack(fill_value=0)
        .reset_index()
    )

    for col in ["view", "cart", "remove_from_cart", "purchase"]:
        if col not in agg_df.columns:
            agg_df[col] = 0

    agg_df["net_cart_count"] = agg_df["cart"] - agg_df["remove_from_cart"]
    agg_df["purchase_count"] = agg_df["purchase"]

    agg_df["is_positive"] = (agg_df["purchase_count"] > 0) | (agg_df["net_cart_count"] > 0)
    agg_df["is_purchase"] = agg_df["purchase_count"] > 0

    return agg_df[["user_id", "product_id", "purchase_count", "net_cart_count", "is_positive", "is_purchase"]]


def get_cutoff_windows() -> Dict[str, Dict[str, pd.Timestamp]]:
    """
    Trả về định nghĩa chuẩn các mốc cắt và khoảng thời gian cửa sổ mục tiêu 14 ngày.
    """
    windows = {}
    all_cutoffs = [
        ("train_1", TRAIN_CUTOFFS[0]),
        ("train_2", TRAIN_CUTOFFS[1]),
        ("train_3", TRAIN_CUTOFFS[2]),
        ("train_4", TRAIN_CUTOFFS[3]),
        ("train_5", TRAIN_CUTOFFS[4]),
        ("val", VALIDATION_CUTOFF),
        ("test_1", TEST_CUTOFF_1),
        ("test_2", TEST_CUTOFF_2),
    ]

    for name, cutoff_str in all_cutoffs:
        cutoff_dt = pd.to_datetime(cutoff_str, utc=True)
        window_end_dt = cutoff_dt + pd.Timedelta(days=TARGET_WINDOW_DAYS)
        windows[name] = {
            "cutoff": cutoff_dt,
            "window_end": window_end_dt,
        }
    return windows


def split_history_and_target(
    df: pd.DataFrame, cutoff: pd.Timestamp, window_days: int = TARGET_WINDOW_DAYS
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Tách dữ liệu thành:
    - history_df: toàn bộ sự kiện < cutoff
    - target_window_df: các sự kiện trong khoảng [cutoff, cutoff + window_days)
    """
    if not pd.api.types.is_datetime64_any_dtype(df["event_time"]):
        df = df.copy()
        df["event_time"] = pd.to_datetime(df["event_time"], utc=True)
    elif df["event_time"].dt.tz is None:
        df = df.copy()
        df["event_time"] = df["event_time"].dt.tz_localize("UTC")

    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    window_end = cutoff + pd.Timedelta(days=window_days)

    history_df = df[df["event_time"] < cutoff].copy()
    target_window_df = df[(df["event_time"] >= cutoff) & (df["event_time"] < window_end)].copy()

    return history_df, target_window_df


def filter_active_users(
    history_df: pd.DataFrame, min_events: int = 3, max_events: int = 1000
) -> Set[int]:
    """
    Lọc người dùng hoạt động hợp lệ dựa trên lịch sử trước cutoff (Tiêu chí C):
    - Tối thiểu min_events (mặc định 3)
    - Tối đa max_events (mặc định 1000) để loại bỏ bot/crawler cực đoan.
    Chỉ chạy trên history_df (không bao giờ dùng dữ liệu sau cutoff).
    """
    user_counts = history_df.groupby("user_id").size()
    valid_users = user_counts[(user_counts >= min_events) & (user_counts <= max_events)].index
    return set(valid_users)


def partition_eval_users(
    target_labels: pd.DataFrame, history_df: pd.DataFrame, purchase_only: bool = False
) -> Tuple[Set[int], Set[int]]:
    """
    Phân tách người dùng đánh giá thành Warm users và Cold users (Tiêu chí B):
    - Đánh giá chỉ thực hiện trên user có >= 1 nhãn dương trong cửa sổ mục tiêu.
    - Warm user: đã từng có ít nhất 1 sự kiện trong history_df (< cutoff).
    - Cold user: chưa từng xuất hiện trong history_df (< cutoff).
    """
    label_col = "is_purchase" if purchase_only else "is_positive"
    pos_labels = target_labels[target_labels[label_col]]
    eval_users = set(pos_labels["user_id"].unique())

    history_users = set(history_df["user_id"].unique()) if not history_df.empty else set()

    warm_users = eval_users.intersection(history_users)
    cold_users = eval_users.difference(history_users)

    return warm_users, cold_users


def verify_temporal_integrity(df: pd.DataFrame, cutoff: pd.Timestamp) -> None:
    """
    Temporal Data Leakage Guard:
    Bắt buộc kiểm tra mọi sự kiện trong DataFrame lịch sử phải xảy ra TRƯỚC mốc cutoff.
    Nếu phát hiện bất kỳ sự kiện nào >= cutoff, ném ra ValueError ngay lập tức.
    """
    if df.empty:
        return

    event_times = df["event_time"]
    if not pd.api.types.is_datetime64_any_dtype(event_times):
        event_times = pd.to_datetime(event_times, utc=True)
    elif event_times.dt.tz is None:
        event_times = event_times.dt.tz_localize("UTC")

    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    leakage_mask = event_times >= cutoff
    if leakage_mask.any():
        num_leaked = leakage_mask.sum()
        max_leaked_time = event_times[leakage_mask].max()
        raise ValueError(
            f"Temporal Data Leakage Detected: Phát hiện {num_leaked} sự kiện >= cutoff ({cutoff}). "
            f"Sự kiện muộn nhất: {max_leaked_time}."
        )


def get_global_candidate_pool(
    history_df: pd.DataFrame, cutoff: pd.Timestamp, days: int = CANDIDATE_POOL_DAYS
) -> Set[int]:
    """
    Xác định tập ứng viên toàn cục (Global Candidate Pool - Tiêu chí E):
    Là các sản phẩm có phát sinh tương tác trong vòng `days` (30 ngày) trước cutoff.
    Tự động gọi verify_temporal_integrity để chặn rò rỉ dữ liệu.
    """
    verify_temporal_integrity(history_df, cutoff)

    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    start_pool_time = cutoff - pd.Timedelta(days=days)
    pool_events = history_df[
        (history_df["event_time"] >= start_pool_time) & (history_df["event_time"] < cutoff)
    ]
    return set(pool_events["product_id"].unique())
