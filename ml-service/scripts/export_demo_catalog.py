# -*- coding: utf-8 -*-
"""
Script trích xuất 188 sản phẩm ứng viên của 3 user demo từ REES46
và chuẩn bị dữ liệu import vào MySQL Giftly.
"""

import json
import os
import sys
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from select_demo_users import find_best_3_users

# Danh sách ảnh Unsplash phong cách quà tặng / lifestyle làm placeholder
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
    u1, u2, u3, cand_pids = find_best_3_users("data/processed/ranker_val_full.parquet")
    print(f"\nĐang xử lý {len(cand_pids)} sản phẩm ứng viên...")

    events_df = pd.read_parquet("data/processed/sampled_events.parquet")
    sub_events = events_df[events_df["product_id"].isin(cand_pids)].drop_duplicates(subset=["product_id"])
    
    meta_map = {}
    for _, row in sub_events.iterrows():
        meta_map[int(row["product_id"])] = {
            "category_code": str(row["category_code"]) if pd.notnull(row["category_code"]) else "unknown",
            "brand": str(row["brand"]) if pd.notnull(row["brand"]) else "Giftly Selected",
            "price": float(row["price"]) if pd.notnull(row["price"]) else 10.0,
        }

    # Đọc thêm từ ranker_val_full phòng trường hợp có item thiếu trong sub_events
    val_df = pd.read_parquet("data/processed/ranker_val_full.parquet")
    sub_val = val_df[val_df["product_id"].isin(cand_pids)].drop_duplicates(subset=["product_id"])
    for _, row in sub_val.iterrows():
        pid = int(row["product_id"])
        if pid not in meta_map:
            meta_map[pid] = {
                "category_code": "unknown",
                "brand": str(row["item_brand"]) if pd.notnull(row["item_brand"]) else "Giftly Selected",
                "price": float(row["item_price"]) if pd.notnull(row["item_price"]) else 10.0,
            }

    products = []
    for idx, pid in enumerate(cand_pids):
        info = meta_map.get(pid, {"category_code": "unknown", "brand": "Giftly Selected", "price": 10.0})
        brand = info["brand"].strip()
        if brand.lower() in ("unknown", "none", "nan", ""):
            brand = "Giftly Selected"
        else:
            brand = brand.capitalize()

        cat_code = info["category_code"].strip()
        if cat_code in ("unknown", "none", "nan", ""):
            cat_display = "Quà tặng phong cách sống"
        else:
            cat_parts = [p.capitalize() for p in cat_code.split(".") if p]
            cat_display = " ".join(cat_parts)

        # Tạo tên hiển thị tổng hợp theo quy định Bước 3: Thương hiệu + loại sản phẩm
        synthetic_name = f"{brand} - {cat_display} #{pid}"
        synthetic_desc = (
            f"Sản phẩm {cat_display} cao cấp từ thương hiệu {brand}. "
            f"[Dữ liệu REES46 ID: {pid} - Hiển thị tổng hợp mô phỏng]"
        )

        # Chuyển đổi giá sang VND thực tế (25.000 VND / USD, chặn dưới 49.000 VND)
        usd_price = info["price"]
        vnd_price = max(49000, int(round(usd_price * 25000 / 1000.0) * 1000))

        img = PLACEHOLDER_IMAGES[idx % len(PLACEHOLDER_IMAGES)]

        products.append({
            "ml_product_id": pid,
            "name": synthetic_name,
            "description": synthetic_desc,
            "price": vnd_price,
            "stock": 50,
            "image_url": img,
            "category_name": "Lifestyle",
            "is_synthetic_display": True,
            "style": "modern",
            "gift_type": "lifestyle",
        })

    demo_users = [
        {
            "ml_user_id": u1,
            "full_name": f"Người dùng REES {u1} (Demo 1)",
            "email": f"demo_rees_{u1}@giftly.vn",
        },
        {
            "ml_user_id": u2,
            "full_name": f"Người dùng REES {u2} (Demo 2)",
            "email": f"demo_rees_{u2}@giftly.vn",
        },
        {
            "ml_user_id": u3,
            "full_name": f"Người dùng REES {u3} (Demo 3)",
            "email": f"demo_rees_{u3}@giftly.vn",
        },
    ]

    out_data = {
        "demo_users": demo_users,
        "products": products,
    }

    out_path = "data/processed/demo_catalog_seed.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)

    print(f"-> Đã xuất thành công {len(products)} sản phẩm và {len(demo_users)} user vào {out_path}")

if __name__ == "__main__":
    main()
