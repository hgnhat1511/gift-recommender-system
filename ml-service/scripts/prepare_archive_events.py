"""Stream the REES46 monthly CSV files into a deterministic user sample.

This script never alters the source CSV files. The output is an experiment-only
Parquet file; it does not replace data/processed/sampled_events.parquet.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

ML_SERVICE = Path(__file__).resolve().parents[1]
ROOT = ML_SERVICE.parent
sys.path.insert(0, str(ML_SERVICE))

from ml_pipeline.data import hash_sample_user  # noqa: E402


CSV_COLUMNS = [
    "event_time",
    "event_type",
    "product_id",
    "category_id",
    "category_code",
    "brand",
    "price",
    "user_id",
    "user_session",
]
EVENT_TYPES = {"view", "cart", "remove_from_cart", "purchase"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-dir", type=Path, default=ROOT.parent / "archive")
    parser.add_argument(
        "--output",
        type=Path,
        default=ML_SERVICE / "data" / "experiments" / "archive_sampled_events_10pct.parquet",
    )
    parser.add_argument("--sample-ratio", type=float, default=0.10)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--chunksize", type=int, default=500_000)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 0 < args.sample_ratio <= 1:
        raise SystemExit("--sample-ratio must be in (0, 1].")
    if args.chunksize < 1:
        raise SystemExit("--chunksize must be positive.")

    files = sorted(args.archive_dir.glob("*.csv"))
    if not files:
        raise SystemExit(f"No CSV files found in {args.archive_dir}")
    if args.output.exists() and not args.overwrite:
        raise SystemExit(f"Refusing to overwrite existing output: {args.output} (pass --overwrite explicitly)")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        args.output.unlink()

    writer = None
    output_schema = None
    total_read = 0
    total_kept = 0
    total_bad_price_or_type = 0
    file_stats = []
    try:
        for csv_path in files:
            file_read = 0
            file_kept = 0
            print(f"[READ] {csv_path.name} ({csv_path.stat().st_size / 1e9:.2f} GB)", flush=True)
            for chunk in pd.read_csv(
                csv_path,
                usecols=CSV_COLUMNS,
                chunksize=args.chunksize,
                dtype={
                    "event_time": "string",
                    "event_type": "string",
                    "product_id": "int64",
                    "category_id": "float64",
                    "category_code": "string",
                    "brand": "string",
                    "price": "float64",
                    "user_id": "int64",
                    "user_session": "string",
                },
            ):
                file_read += len(chunk)
                total_read += len(chunk)
                chunk["event_type"] = chunk["event_type"].str.lower().str.strip()
                valid = chunk["event_type"].isin(EVENT_TYPES) & chunk["price"].gt(0)
                total_bad_price_or_type += int((~valid).sum())
                chunk = chunk.loc[valid].copy()

                sample_users = {
                    int(user_id)
                    for user_id in chunk["user_id"].drop_duplicates().tolist()
                    if hash_sample_user(int(user_id), args.sample_ratio, args.seed)
                }
                chunk = chunk.loc[chunk["user_id"].isin(sample_users)].copy()
                if chunk.empty:
                    continue

                chunk["event_time"] = pd.to_datetime(chunk["event_time"], utc=True, errors="coerce")
                chunk = chunk.dropna(subset=["event_time", "product_id", "user_id"])
                chunk["category_code"] = chunk["category_code"].fillna("unknown").astype(str)
                chunk["brand"] = chunk["brand"].fillna("unknown").astype(str)
                chunk = chunk.drop_duplicates(subset=["event_time", "event_type", "product_id", "user_id"])
                chunk = chunk[CSV_COLUMNS]
                table = pa.Table.from_pandas(chunk, preserve_index=False)
                if writer is None:
                    output_schema = table.schema
                    writer = pq.ParquetWriter(args.output, output_schema, compression="zstd")
                elif table.schema != output_schema:
                    table = table.cast(output_schema)
                writer.write_table(table)
                file_kept += len(chunk)
                total_kept += len(chunk)

            file_stats.append({"file": csv_path.name, "rows_read": file_read, "sampled_rows_written": file_kept})
            print(f"[DONE] {csv_path.name}: {file_read:,} rows read, {file_kept:,} sampled rows", flush=True)
    finally:
        if writer is not None:
            writer.close()

    if writer is None:
        args.output.unlink(missing_ok=True)
        raise SystemExit("No valid sampled rows were found; no Parquet output created.")

    report = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_directory": str(args.archive_dir.resolve()),
        "source_files": file_stats,
        "rows_read": total_read,
        "rows_written": total_kept,
        "rows_excluded_invalid_type_or_price": total_bad_price_or_type,
        "sample_ratio": args.sample_ratio,
        "sample_seed": args.seed,
        "sampling_unit": "user_id",
        "sampling_method": "deterministic md5 hash_sample_user",
        "event_types": sorted(EVENT_TYPES),
        "output": str(args.output.resolve()),
        "note": "General e-commerce benchmark data; not gift-domain training evidence.",
    }
    report_path = args.output.with_suffix(".json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
