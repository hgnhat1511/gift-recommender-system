"""Train and evaluate an isolated LightGBM recommender experiment from Parquet events.

The frozen serving artifact is never touched. The default output is a unique
directory under data/experiments and models/experiments.
"""

from __future__ import annotations

import argparse
import gc
import json
import pickle
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ML_SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_SERVICE))

from ml_pipeline.data import (  # noqa: E402
    CANDIDATE_POOL_DAYS,
    TARGET_WINDOW_DAYS,
    TRAIN_CUTOFFS,
    VALIDATION_CUTOFF,
    compute_net_cart_labels,
    get_global_candidate_pool,
    split_history_and_target,
)
from ml_pipeline.models import (  # noqa: E402
    ContentBasedRecommender,
    ItemKNNRecommender,
    PopularityRecommender,
)
from ml_pipeline.ranker import (  # noqa: E402
    FEATURE_COLUMNS,
    CategoricalEncoder,
    evaluate_ranker_on_validation,
    predict_ranker_scores,
    train_ranker_model,
)
from ml_pipeline.ranker_dataset import build_ranker_dataset_for_cutoff  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--events",
        type=Path,
        default=ML_SERVICE / "data" / "experiments" / "archive_sampled_events_10pct.parquet",
    )
    parser.add_argument("--max-users", type=int, default=15_000)
    parser.add_argument("--n-estimators", type=int, default=500)
    parser.add_argument("--n-jobs", type=int, default=4)
    parser.add_argument("--num-leaves", type=int, default=15)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--output-name", default=None)
    return parser.parse_args()


def make_retrievers(history: pd.DataFrame, cutoff: pd.Timestamp, candidate_pool: set[int]):
    del cutoff  # The history has already been restricted to timestamps before cutoff.
    popularity = PopularityRecommender().fit(history, candidate_pool)
    content = ContentBasedRecommender(fallback_pop=popularity).fit(history, candidate_pool)
    knn = ItemKNNRecommender(top_similar_items=None, fallback_pop=popularity).fit(history, candidate_pool)
    return popularity, knn, content


def make_labels(target: pd.DataFrame):
    labels = compute_net_cart_labels(target)
    positive = labels[labels["is_positive"]]
    ground_truth = positive.groupby("user_id")["product_id"].apply(set).to_dict()
    purchases = target[target["event_type"] == "purchase"]
    purchase_truth = purchases.groupby("user_id")["product_id"].apply(set).to_dict()
    return labels, ground_truth, purchase_truth


def make_eval_segments(ground_truth: dict[int, set[int]], history: pd.DataFrame, cutoff: pd.Timestamp):
    eval_users = set(ground_truth)
    all_history_users = set(history["user_id"].unique())
    recent_start = cutoff - pd.Timedelta(days=30)
    recent_history_users = set(history.loc[history["event_time"] >= recent_start, "user_id"].unique())
    return (
        {user for user in eval_users if user in all_history_users},
        {user for user in eval_users if user not in all_history_users},
        {user for user in eval_users if user in recent_history_users},
        {user for user in eval_users if user not in recent_history_users},
    )


def build_dataset(
    events: pd.DataFrame,
    cutoff_text: str,
    max_users: int,
    downsample_negatives: bool,
    seed: int,
):
    cutoff = pd.to_datetime(cutoff_text, utc=True)
    history, target = split_history_and_target(events, cutoff, TARGET_WINDOW_DAYS)
    pool = get_global_candidate_pool(history, cutoff, CANDIDATE_POOL_DAYS)
    popularity, knn, content = make_retrievers(history, cutoff, pool)
    dataset, stats = build_ranker_dataset_for_cutoff(
        history,
        target,
        cutoff,
        pool,
        popularity,
        knn,
        content,
        max_users=max_users,
        max_neg_ratio=30,
        seed=seed,
        downsample_negatives=downsample_negatives,
    )
    return dataset, stats, history, target, pool


def evaluate_split(
    events: pd.DataFrame,
    cutoff_text: str,
    model,
    encoder: CategoricalEncoder,
    max_users: int,
):
    dataset, stats, history, target, _pool = build_dataset(
        events,
        cutoff_text,
        max_users=max_users,
        downsample_negatives=False,
        seed=42,
    )
    if dataset.empty:
        return {"stats": stats, "metrics": {}, "baseline_popularity": {}}

    cutoff = pd.to_datetime(cutoff_text, utc=True)
    labels, ground_truth, purchase_truth = make_labels(target)
    warm, cold, warm_30d, cold_30d = make_eval_segments(ground_truth, history, cutoff)
    ordered = dataset.sort_values(["user_id", "product_id"]).reset_index(drop=True)
    encoded = encoder.transform(ordered)
    scores = predict_ranker_scores(model, "LGBMClassifier", encoded[FEATURE_COLUMNS])
    metrics = evaluate_ranker_on_validation(
        encoded,
        scores,
        ground_truth,
        purchase_truth,
        warm,
        cold,
        warm_30d,
        cold_30d,
        k=10,
    )

    # A direct popularity-channel baseline on exactly the same candidate set.
    baseline_df = encoded[["user_id", "product_id", "pop_rank"]].sort_values(
        ["user_id", "pop_rank", "product_id"]
    )
    baseline_recs = baseline_df.groupby("user_id").head(10).groupby("user_id")["product_id"].apply(list).to_dict()
    from ml_pipeline.evaluate import ndcg_at_k, recall_at_k, precision_at_k

    baseline = {
        "ndcg@10": float(np.mean([ndcg_at_k(gt, baseline_recs.get(u, []), 10) for u, gt in ground_truth.items()])),
        "recall@10": float(np.mean([recall_at_k(gt, baseline_recs.get(u, []), 10) for u, gt in ground_truth.items()])),
        "precision@10": float(np.mean([precision_at_k(gt, baseline_recs.get(u, []), 10) for u, gt in ground_truth.items()])),
    }
    del labels, dataset, ordered, encoded
    gc.collect()
    return {"stats": stats, "metrics": metrics, "baseline_popularity": baseline}


def main() -> None:
    args = parse_args()
    if not args.events.is_file():
        raise SystemExit(f"Events Parquet not found: {args.events}. Run prepare_archive_events.py first.")
    if args.max_users < 1 or args.n_estimators < 1 or args.n_jobs < 1:
        raise SystemExit("max-users, n-estimators, and n-jobs must be positive.")

    run_name = args.output_name or datetime.now(timezone.utc).strftime("archive_lgbm_%Y%m%dT%H%M%SZ")
    data_dir = ML_SERVICE / "data" / "experiments" / run_name
    model_dir = ML_SERVICE / "models" / "experiments" / run_name
    if data_dir.exists() or model_dir.exists():
        raise SystemExit(f"Refusing to overwrite experiment output: {run_name}")
    data_dir.mkdir(parents=True)
    model_dir.mkdir(parents=True)

    print(f"[LOAD] {args.events}", flush=True)
    events = pd.read_parquet(args.events)
    events["event_time"] = pd.to_datetime(events["event_time"], utc=True)
    events = events.sort_values("event_time").reset_index(drop=True)
    print(
        f"[DATA] rows={len(events):,}, users={events.user_id.nunique():,}, "
        f"products={events.product_id.nunique():,}, dates={events.event_time.min()}..{events.event_time.max()}",
        flush=True,
    )

    train_parts = []
    train_stats = []
    for index, cutoff_text in enumerate(TRAIN_CUTOFFS, start=1):
        started = time.perf_counter()
        print(f"[TRAIN-DATA {index}/{len(TRAIN_CUTOFFS)}] cutoff={cutoff_text}", flush=True)
        part, stats, *_ = build_dataset(
            events,
            cutoff_text,
            max_users=args.max_users,
            downsample_negatives=True,
            seed=42 + index,
        )
        part["cutoff"] = cutoff_text
        train_parts.append(part)
        train_stats.append(stats)
        print(
            f"[TRAIN-DATA DONE] rows={len(part):,}, users={stats['total_eval_users']:,}, "
            f"candidate_recall={stats['candidate_recall']:.4f}, seconds={time.perf_counter()-started:.1f}",
            flush=True,
        )
        gc.collect()

    train = pd.concat(train_parts, ignore_index=True)
    train.to_parquet(data_dir / "train.parquet", index=False, compression="zstd")
    del train_parts
    gc.collect()

    print(f"[VALIDATION-DATA] cutoff={VALIDATION_CUTOFF}", flush=True)
    validation, validation_stats, *_ = build_dataset(
        events,
        VALIDATION_CUTOFF,
        max_users=args.max_users,
        downsample_negatives=False,
        seed=42,
    )
    validation["cutoff"] = VALIDATION_CUTOFF
    validation.to_parquet(data_dir / "validation_full.parquet", index=False, compression="zstd")

    encoder = CategoricalEncoder().fit(train)
    train = train.sort_values(["cutoff", "user_id"]).reset_index(drop=True)
    validation = validation.sort_values(["user_id"]).reset_index(drop=True)
    train_encoded = encoder.transform(train)
    validation_encoded = encoder.transform(validation)
    train_groups = train_encoded.groupby(["cutoff", "user_id"], sort=False).size().values

    config = {
        "num_leaves": args.num_leaves,
        "learning_rate": args.learning_rate,
        "n_estimators": args.n_estimators,
    }
    print(
        f"[FIT] LGBMClassifier config={config}, train_rows={len(train_encoded):,}, "
        f"validation_rows={len(validation_encoded):,}",
        flush=True,
    )
    model, fit_seconds = train_ranker_model(
        "LGBMClassifier",
        config,
        train_encoded[FEATURE_COLUMNS],
        train_encoded["label"].to_numpy(dtype=np.int32),
        train_groups,
        validation_encoded[FEATURE_COLUMNS],
        validation_encoded["label"].to_numpy(dtype=np.int32),
        validation_encoded.groupby("user_id", sort=False).size().values,
        random_state=42,
        n_jobs=args.n_jobs,
    )

    # Keep both chronological test windows sealed. This experimental trainer
    # is validation-only; test scoring requires a separate, explicitly approved
    # final-evaluation step after model selection is frozen.
    print("[EVALUATE] validation only; test_1 and test_2 are not scored", flush=True)
    validation_result = evaluate_split(events, VALIDATION_CUTOFF, model, encoder, args.max_users)

    summary = {
        "experiment": run_name,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_events": str(args.events.resolve()),
        "source_rows": int(len(events)),
        "source_users": int(events.user_id.nunique()),
        "source_products": int(events.product_id.nunique()),
        "source_date_min": events.event_time.min().isoformat(),
        "source_date_max": events.event_time.max().isoformat(),
        "model_family": "LGBMClassifier (probability score used to rank candidates)",
        "config": config,
        "feature_count": len(FEATURE_COLUMNS),
        "fit_seconds": fit_seconds,
        "best_iteration": int(getattr(model, "best_iteration_", 0) or 0),
        "train_windows": train_stats,
        "validation_dataset": validation_stats,
        "validation": validation_result,
        "test_1_scored": False,
        "test_2_scored": False,
        "domain_limit": "REES46 is general e-commerce behavior data, not gift-domain evidence.",
        "serving_artifact_overwritten": False,
    }
    (data_dir / "metrics.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    artifact = {
        "config_id": run_name,
        "model_family": "LGBMClassifier",
        "feature_columns": FEATURE_COLUMNS,
        "encoder": encoder,
        "model": model,
        "metrics": validation_result.get("metrics", {}).get("primary_all", {}),
        "experiment_data": str(data_dir.resolve()),
    }
    artifact_path = model_dir / "ranker_experiment.pkl"
    with artifact_path.open("wb") as stream:
        pickle.dump(artifact, stream, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"[SAVED] model={artifact_path}", flush=True)
    print(f"[SAVED] metrics={data_dir / 'metrics.json'}", flush=True)
    print(
        json.dumps(
            {
                "validation": validation_result["metrics"].get("primary_all"),
                "baseline_popularity_val": validation_result["baseline_popularity"],
                "test_1": "NOT_SCORED",
                "test_2": "NOT_SCORED",
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
