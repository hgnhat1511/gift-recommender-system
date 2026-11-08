# -*- coding: utf-8 -*-
"""
select1000Catalog.py
Chọn xác định đúng 1.000 sản phẩm thật từ REES46 có ml_product_id nằm trong pool LC-1.
- seed = 42
- Phân tầng theo danh mục (category_id / category_code)
- Bảo đảm bao gồm các ứng viên của 3 user demo để phục vụ serving LC-1
- Ghi danh sách ID ra core-backend/data/selected_1000_ids.json
- Ghi dữ liệu nạp ra core-backend/data/selected_1000_products.json
"""

import json
import os
import sys
import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

PLACEHOLDER_IMAGES = [
    "https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1513883049090-d0b7439799bf?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=85",
]

def main():
    val_path = "ml-service/data/processed/ranker_val_full.parquet"
    events_path = "ml-service/data/processed/sampled_events.parquet"

    if not os.path.exists(val_path) or not os.path.exists(events_path):
        print(f"Lỗi: Không tìm thấy file dữ liệu {val_path} hoặc {events_path}")
        sys.exit(1)

    val_df = pd.read_parquet(val_path)
    cand_pids = set(val_df["product_id"].unique())
    print(f"Tổng số ứng viên duy nhất trong LC-1 pool: {len(cand_pids)}")

    events_df = pd.read_parquet(events_path)
    sub_events = events_df[events_df["product_id"].isin(cand_pids)].drop_duplicates(subset=["product_id"]).copy()

    # Nhóm danh mục
    def get_cat_key(row):
        code = str(row["category_code"]) if pd.notnull(row["category_code"]) else ""
        if code and code not in ("None", "nan", "unknown"):
            return code.split(".")[0]
        return f"cat_{row['category_id']}"

    sub_events["cat_key"] = sub_events.apply(get_cat_key, axis=1)

    # Lấy ứng viên của 3 user demo
    demo_uids = [431235351, 519418027, 524084300]
    demo_cands = set(val_df[val_df["user_id"].isin(demo_uids)]["product_id"].unique())
    print(f"Số ứng viên của 3 user demo: {len(demo_cands)}")

    # Bắt đầu chọn 1.000 sản phẩm với seed = 42
    # Trước tiên đưa các ứng viên của demo users vào danh sách chọn
    selected_pids = set(demo_cands)
    remaining_needed = 1000 - len(selected_pids)
    print(f"Cần chọn thêm {remaining_needed} sản phẩm từ pool qua phân tầng danh mục...")

    # Tập còn lại để phân tầng
    pool_remaining = sub_events[~sub_events["product_id"].isin(selected_pids)].copy()

    # Tính tỷ lệ phân tầng theo cat_key
    cat_counts = pool_remaining["cat_key"].value_counts()
    cat_weights = cat_counts / len(pool_remaining)
    cat_allocations = (cat_weights * remaining_needed).round().astype(int)

    # Điều chỉnh để tổng phân bổ bằng chính xác remaining_needed
    diff = remaining_needed - cat_allocations.sum()
    top_cats = cat_allocations.index[:abs(diff)]
    for cat in top_cats:
        cat_allocations[cat] += int(np.sign(diff))

    rng = np.random.RandomState(42)

    stratified_samples = []
    for cat, n_samples in cat_allocations.items():
        if n_samples <= 0:
            continue
        group_pids = pool_remaining[pool_remaining["cat_key"] == cat]["product_id"].tolist()
        if len(group_pids) <= n_samples:
            stratified_samples.extend(group_pids)
        else:
            sampled = rng.choice(group_pids, size=n_samples, replace=False).tolist()
            stratified_samples.extend(sampled)

    for pid in stratified_samples:
        selected_pids.add(int(pid))

    # Nếu còn thiếu hoặc thừa do làm tròn, bổ sung từ pool bằng rng
    if len(selected_pids) < 1000:
        pool_left = list(cand_pids - selected_pids)
        needed = 1000 - len(selected_pids)
        extra = rng.choice(pool_left, size=needed, replace=False).tolist()
        for pid in extra:
            selected_pids.add(int(pid))
    elif len(selected_pids) > 1000:
        # Giữ demo_cands, bỏ bớt trong phần thêm
        added_list = list(selected_pids - demo_cands)
        keep_count = 1000 - len(demo_cands)
        kept_added = set(rng.choice(added_list, size=keep_count, replace=False))
        selected_pids = demo_cands.union(kept_added)

    final_pid_list = [int(p) for p in sorted(list(selected_pids))]
    print(f"Xác nhận số sản phẩm đã chọn: {len(final_pid_list)} (Đúng 1000 sản phẩm duy nhất)")
    assert len(final_pid_list) == 1000, "Số lượng sản phẩm không đúng 1000!"
    assert all(pid in cand_pids for pid in final_pid_list), "Có sản phẩm ngoài LC-1 candidate pool!"

    # Thu thập metadata cho 1.000 sản phẩm
    selected_events = sub_events[sub_events["product_id"].isin(final_pid_list)].drop_duplicates(subset=["product_id"])
    meta_by_pid = {}
    for _, row in selected_events.iterrows():
        meta_by_pid[int(row["product_id"])] = {
            "category_code": str(row["category_code"]) if pd.notnull(row["category_code"]) else "",
            "brand": str(row["brand"]) if pd.notnull(row["brand"]) else "",
            "price": float(row["price"]) if pd.notnull(row["price"]) else 10.0,
        }

    # Bổ sung từ val_df nếu còn thiếu
    sub_val = val_df[val_df["product_id"].isin(final_pid_list)].drop_duplicates(subset=["product_id"])
    for _, row in sub_val.iterrows():
        pid = int(row["product_id"])
        if pid not in meta_by_pid:
            meta_by_pid[pid] = {
                "category_code": "",
                "brand": str(row["item_brand"]) if pd.notnull(row["item_brand"]) else "",
                "price": float(row["item_price"]) if pd.notnull(row["item_price"]) else 10.0,
            }

    products = []
    for idx, pid in enumerate(final_pid_list):
        info = meta_by_pid.get(pid, {"category_code": "", "brand": "", "price": 10.0})
        raw_brand = info["brand"].strip()
        if raw_brand.lower() in ("unknown", "none", "nan", ""):
            brand = "Giftly Selected"
        else:
            brand = raw_brand.capitalize()

        cat_code = info["category_code"].strip()
        if cat_code in ("unknown", "none", "nan", ""):
            cat_display = "Phong cách sống & Tiện ích"
        else:
            parts = [p.capitalize() for p in cat_code.split(".") if p]
            cat_display = " ".join(parts)

        orig_price = info["price"]
        # Quy đổi tỷ giá 25.000 VND, sàn 49.000 VND
        vnd_price = max(49000, int(round(orig_price * 25000 / 1000.0) * 1000))

        name = f"{brand} - {cat_display} #{pid}"
        desc = (
            f"Sản phẩm {cat_display} từ thương hiệu {brand}. "
            f"Giá gốc REES46: {orig_price:.2f} (chưa xác định đơn vị, quy đổi tạm tính tỷ giá 25.000 VND). "
            f"[Dữ liệu REES46 ID: {pid}]"
        )
        img = PLACEHOLDER_IMAGES[idx % len(PLACEHOLDER_IMAGES)]

        products.append({
            "ml_product_id": pid,
            "name": name,
            "description": desc,
            "price": vnd_price,
            "stock": 50,
            "image_url": img,
            "category_name": "Lifestyle",
            "is_synthetic_display": True,
            "style": "modern",
            "gift_type": "lifestyle",
            "occasion_tags": ["birthday"],
            "recipient_tags": ["friend"],
            "interest_tags": ["lifestyle"]
        })

    os.makedirs("core-backend/data", exist_ok=True)
    with open("core-backend/data/selected_1000_ids.json", "w", encoding="utf-8") as f:
        json.dump(final_pid_list, f, indent=2)

    with open("core-backend/data/selected_1000_products.json", "w", encoding="utf-8") as f:
        json.dump(products, f, indent=2, ensure_ascii=False)

    print(f"Đã lưu danh sách 1000 IDs vào core-backend/data/selected_1000_ids.json")
    print(f"Đã lưu danh sách 1000 sản phẩm vào core-backend/data/selected_1000_products.json")

if __name__ == "__main__":
    main()
