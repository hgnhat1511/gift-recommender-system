"""
Module đánh giá độ chính xác và thống kê (Evaluation Metrics & Bootstrap CI).
Tuân thủ nghiêm ngặt:
- Precision@K, Recall@K, F1@K, HitRate@K, MAP@K, NDCG@K (với K in [5, 10, 20]).
- Catalog Coverage, Candidate Recall@120.
- Tiêu chí F: 95% User Bootstrap Confidence Interval để kiểm định ý nghĩa thống kê của chênh lệch hiệu năng.
"""

from typing import Dict, List, Optional, Sequence, Set, Tuple, Union
import numpy as np


def precision_at_k(actual: Set[int], predicted: Sequence[int], k: int = 10) -> float:
    """Độ chính xác tại K (Precision@K)."""
    if k <= 0:
        return 0.0
    pred_k = predicted[:k]
    hits = len(set(pred_k).intersection(actual))
    return float(hits / k)


def recall_at_k(actual: Set[int], predicted: Sequence[int], k: int = 10) -> float:
    """Độ nhạy tại K (Recall@K)."""
    if not actual:
        return 0.0
    pred_k = predicted[:k]
    hits = len(set(pred_k).intersection(actual))
    return float(hits / len(actual))


def f1_at_k(actual: Set[int], predicted: Sequence[int], k: int = 10) -> float:
    """F1-score tại K."""
    p = precision_at_k(actual, predicted, k)
    r = recall_at_k(actual, predicted, k)
    if (p + r) == 0.0:
        return 0.0
    return float(2 * p * r / (p + r))


def hit_rate_at_k(actual: Set[int], predicted: Sequence[int], k: int = 10) -> float:
    """Tỷ lệ trúng tại K (HitRate@K)."""
    pred_k = predicted[:k]
    return 1.0 if len(set(pred_k).intersection(actual)) > 0 else 0.0


def dcg_at_k(actual: Set[int], predicted: Sequence[int], k: int = 10) -> float:
    """Discounted Cumulative Gain tại K."""
    pred_k = predicted[:k]
    dcg = 0.0
    for i, item in enumerate(pred_k):
        if item in actual:
            dcg += 1.0 / np.log2(i + 2)  # vị trí i bắt đầu từ 0, log2(i + 2)
    return float(dcg)


def ndcg_at_k(actual: Set[int], predicted: Sequence[int], k: int = 10) -> float:
    """Normalized Discounted Cumulative Gain tại K (NDCG@K)."""
    if not actual:
        return 0.0
    dcg = dcg_at_k(actual, predicted, k)
    # Tính IDCG@K (lý tưởng: các sản phẩm hit đều ở đầu bảng)
    ideal_hits = min(k, len(actual))
    idcg = sum(1.0 / np.log2(i + 2) for i in range(ideal_hits))
    if idcg == 0.0:
        return 0.0
    return float(dcg / idcg)


def map_at_k(actual: Set[int], predicted: Sequence[int], k: int = 10) -> float:
    """Mean Average Precision tại K (MAP@K)."""
    if not actual:
        return 0.0
    pred_k = predicted[:k]
    score = 0.0
    num_hits = 0.0
    for i, item in enumerate(pred_k):
        if item in actual:
            num_hits += 1.0
            score += num_hits / (i + 1.0)
    ideal_hits = min(k, len(actual))
    if ideal_hits == 0:
        return 0.0
    return float(score / ideal_hits)


def catalog_coverage(all_recommendations: List[Sequence[int]], total_catalog_items: Set[int]) -> float:
    """Độ phủ danh mục: Tỷ lệ sản phẩm được gợi ý trên tổng số sản phẩm trong catalog."""
    if not total_catalog_items:
        return 0.0
    recommended_items: Set[int] = set()
    for recs in all_recommendations:
        recommended_items.update(recs)
    return float(len(recommended_items.intersection(total_catalog_items)) / len(total_catalog_items))


def candidate_recall_at_k(actual: Set[int], candidates: Sequence[int], k: int = 120) -> float:
    """Độ phủ nhãn dương của bộ sinh ứng viên tại K (mặc định K=120 theo Tiêu chí E)."""
    if not actual:
        return 0.0
    cand_k = candidates[:k]
    hits = len(set(cand_k).intersection(actual))
    return float(hits / len(actual))


def bootstrap_ci(
    diffs: Union[List[float], np.ndarray],
    n_bootstrap: int = 1000,
    ci: float = 0.95,
    seed: int = 42,
) -> Tuple[float, float, float, bool]:
    """
    Tính khoảng tin cậy Bootstrap 95% theo người dùng cho hiệu số hiệu năng (Tiêu chí F.1 & F.3).
    Trả về:
    (mean_diff, ci_lower, ci_upper, excludes_zero)
    """
    arr = np.asarray(diffs, dtype=np.float64)
    if len(arr) == 0:
        return 0.0, 0.0, 0.0, False

    mean_val = float(np.mean(arr))
    rng = np.random.RandomState(seed)

    boot_means = np.empty(n_bootstrap, dtype=np.float64)
    n = len(arr)
    for b in range(n_bootstrap):
        sample = rng.choice(arr, size=n, replace=True)
        boot_means[b] = np.mean(sample)

    alpha = (1.0 - ci) / 2.0
    ci_lower = float(np.percentile(boot_means, alpha * 100))
    ci_upper = float(np.percentile(boot_means, (1.0 - alpha) * 100))

    # Khoảng tin cậy loại trừ 0 nếu 0 không nằm trong [ci_lower, ci_upper]
    excludes_zero = (ci_lower > 0) or (ci_upper < 0)

    return mean_val, ci_lower, ci_upper, excludes_zero


def evaluate_recommendations(
    ground_truth: Dict[int, Set[int]],
    recommendations: Dict[int, List[int]],
    ks: List[int] = [5, 10, 20],
) -> Dict[str, float]:
    """
    Đánh giá tập hợp người dùng trên nhiều giá trị K.
    Trả về dict các giá trị trung bình trên toàn bộ users.
    """
    results: Dict[str, List[float]] = {}
    for k in ks:
        results[f"NDCG@{k}"] = []
        results[f"Recall@{k}"] = []
        results[f"Precision@{k}"] = []
        results[f"HitRate@{k}"] = []
        results[f"MAP@{k}"] = []

    for user_id, actual_set in ground_truth.items():
        recs = recommendations.get(user_id, [])
        for k in ks:
            results[f"NDCG@{k}"].append(ndcg_at_k(actual_set, recs, k))
            results[f"Recall@{k}"].append(recall_at_k(actual_set, recs, k))
            results[f"Precision@{k}"].append(precision_at_k(actual_set, recs, k))
            results[f"HitRate@{k}"].append(hit_rate_at_k(actual_set, recs, k))
            results[f"MAP@{k}"].append(map_at_k(actual_set, recs, k))

    summary: Dict[str, float] = {}
    for metric_name, values in results.items():
        summary[metric_name] = float(np.mean(values)) if values else 0.0

    return summary
