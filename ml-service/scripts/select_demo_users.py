# -*- coding: utf-8 -*-
"""
Script chọn 3 user demo từ tập validation (ranker_val_full.parquet).
Tiêu chuẩn:
- Có nhiều ứng viên (80 - 150 ứng viên).
- Có ít nhất 1 nhãn dương (label == 1: net cart / purchase).
- Có độ giao thoa ứng viên cao để tiết kiệm số lượng sản phẩm nhập vào catalog (~200-300 sản phẩm).
"""

import sys
import pandas as pd
from typing import List, Tuple

sys.stdout.reconfigure(encoding="utf-8")

def find_best_3_users(parquet_path: str = "data/processed/ranker_val_full.parquet"):
    df = pd.read_parquet(parquet_path)
    
    stats = df.groupby("user_id").agg(
        n_cands=("product_id", "count"),
        n_pos=("label", "sum"),
    ).reset_index()

    # Lọc các user có ít nhất 1 nhãn dương và nhiều ứng viên (>= 90)
    candidates = stats[(stats["n_pos"] >= 1) & (stats["n_cands"] >= 90)].sort_values(
        by=["n_pos", "n_cands"], ascending=[False, False]
    )

    user_item_map = {
        int(u): set(df[df["user_id"] == u]["product_id"])
        for u in candidates["user_id"].head(50)
    }

    cand_list = list(user_item_map.keys())
    
    # Tìm bộ 3 user có giao thoa nhiều nhất mà tổng số sản phẩm hợp nhất khoảng 200-300
    best_combo = None
    best_intersection_sum = -1
    
    for i in range(len(cand_list)):
        u1 = cand_list[i]
        s1 = user_item_map[u1]
        for j in range(i + 1, len(cand_list)):
            u2 = cand_list[j]
            s2 = user_item_map[u2]
            for k in range(j + 1, len(cand_list)):
                u3 = cand_list[k]
                s3 = user_item_map[u3]
                
                union_len = len(s1 | s2 | s3)
                if 180 <= union_len <= 350:
                    common_12 = len(s1 & s2)
                    common_23 = len(s2 & s3)
                    common_13 = len(s1 & s3)
                    common_all = len(s1 & s2 & s3)
                    score = common_12 + common_23 + common_13
                    if score > best_intersection_sum:
                        best_intersection_sum = score
                        best_combo = (u1, u2, u3, union_len, common_12, common_23, common_13, common_all)

    if not best_combo:
        # Nếu không có combo trong khoảng 180-350, lấy 3 user đầu tiên
        u1, u2, u3 = cand_list[0], cand_list[1], cand_list[2]
        s1, s2, s3 = user_item_map[u1], user_item_map[u2], user_item_map[u3]
        best_combo = (u1, u2, u3, len(s1 | s2 | s3), len(s1 & s2), len(s2 & s3), len(s1 & s3), len(s1 & s2 & s3))

    u1, u2, u3, union_len, c12, c23, c13, c_all = best_combo

    print("==================================================================")
    print("KẾT QUẢ CHỌN 3 USER DEMO TỪ ranker_val_full.parquet (BƯỚC 2):")
    print("==================================================================")
    for u in [u1, u2, u3]:
        u_row = stats[stats["user_id"] == u].iloc[0]
        print(f"User ID: {u} | Số ứng viên: {int(u_row['n_cands'])} | Số nhãn dương: {int(u_row['n_pos'])}")

    print("------------------------------------------------------------------")
    print(f"Số ứng viên chung giữa User {u1} và {u2}: {c12}")
    print(f"Số ứng viên chung giữa User {u2} và {u3}: {c23}")
    print(f"Số ứng viên chung giữa User {u1} và {u3}: {c13}")
    print(f"Số ứng viên chung của cả 3 user: {c_all}")
    print(f"Tổng số sản phẩm phân biệt (Union): {union_len} sản phẩm")
    print("==================================================================")

    # In thông tin các nhãn dương của từng user
    for u in [u1, u2, u3]:
        pos_items = df[(df["user_id"] == u) & (df["label"] == 1)][["product_id", "label"]].to_dict("records")
        print(f"User {u} có các product_id nhãn dương: {[it['product_id'] for it in pos_items]}")

    return u1, u2, u3, list(user_item_map[u1] | user_item_map[u2] | user_item_map[u3])

if __name__ == "__main__":
    find_best_3_users()
