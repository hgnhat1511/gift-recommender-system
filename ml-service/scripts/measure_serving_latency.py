# -*- coding: utf-8 -*-
"""
Kịch bản đo độ trễ End-to-End của endpoint /recommend/rank qua HTTP thực tế trên 200 requests (Bước 3).
Sử dụng threading để chạy uvicorn server và urllib để gửi request HTTP thực tế.
"""

import json
import os
import sys
import threading
import time
import urllib.request

import numpy as np
import pandas as pd
import uvicorn

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app

PORT = 8008
HOST = "127.0.0.1"
BASE_URL = f"http://{HOST}:{PORT}"


def run_benchmark():
    # 1. Khởi động server FastAPI trên một luồng nền
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Đợi server sẵn sàng
    health_url = f"{BASE_URL}/health"
    rank_url = f"{BASE_URL}/recommend/rank"

    server_ready = False
    for _ in range(30):
        try:
            with urllib.request.urlopen(health_url, timeout=1.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    print(f"Server ready! Model: {data['modelVersion']}, SHA-256: {data['modelSha256'][:16]}...")
                    server_ready = True
                    break
        except Exception:
            time.sleep(0.3)

    if not server_ready:
        server.should_exit = True
        raise RuntimeError("Khong the khoi dong server uvicorn!")

    try:
        # 2. Chuẩn bị danh sách 200 requests
        val_df = pd.read_parquet("data/processed/ranker_val_full.parquet")
        unique_users = val_df["user_id"].unique()
        test_users = list(unique_users[:180]) + [999999991, 999999992] * 10  # 180 warm + 20 cold = 200 requests

        # 3. Warm-up 20 requests
        print("Warm-up 20 requests...")
        for u in test_users[:20]:
            req_data = json.dumps({"user_id": int(u), "top_k": 10}).encode("utf-8")
            req = urllib.request.Request(rank_url, data=req_data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                _ = resp.read()

        # 4. Đo 200 requests chính thức
        print("Measuring end-to-end latency on 200 requests via HTTP...")
        latencies_ms = []

        for i, u in enumerate(test_users):
            req_data = json.dumps({"user_id": int(u), "top_k": 10}).encode("utf-8")
            req = urllib.request.Request(rank_url, data=req_data, headers={"Content-Type": "application/json"})

            t0 = time.perf_counter()
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                body = resp.read()
            t_ms = (time.perf_counter() - t0) * 1000.0
            latencies_ms.append(t_ms)

        # 5. Thống kê số liệu
        arr = np.array(latencies_ms)
        mean_lat = float(np.mean(arr))
        p50 = float(np.percentile(arr, 50))
        p90 = float(np.percentile(arr, 90))
        p95 = float(np.percentile(arr, 95))
        p99 = float(np.percentile(arr, 99))
        min_lat = float(np.min(arr))
        max_lat = float(np.max(arr))

        print("\n" + "=" * 60)
        print("HTTP END-TO-END LATENCY BENCHMARK (200 REQUESTS)")
        print("=" * 60)
        print(f"Total requests:    200")
        print(f"Mean latency:      {mean_lat:.2f} ms")
        print(f"Median (p50):      {p50:.2f} ms")
        print(f"90th percentile:   {p90:.2f} ms")
        print(f"95th percentile:   {p95:.2f} ms (Target <= 50 ms)")
        print(f"99th percentile:   {p99:.2f} ms")
        print(f"Min / Max:         {min_lat:.2f} ms / {max_lat:.2f} ms")
        print("=" * 60)

        results = {
            "total_requests": 200,
            "mean_ms": round(mean_lat, 2),
            "p50_ms": round(p50, 2),
            "p90_ms": round(p90, 2),
            "p95_ms": round(p95, 2),
            "p99_ms": round(p99, 2),
            "min_ms": round(min_lat, 2),
            "max_ms": round(max_lat, 2),
        }

        os.makedirs("data/processed", exist_ok=True)
        with open("data/processed/serving_latency_results.json", "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

    finally:
        server.should_exit = True
        thread.join(timeout=2.0)


if __name__ == "__main__":
    run_benchmark()
