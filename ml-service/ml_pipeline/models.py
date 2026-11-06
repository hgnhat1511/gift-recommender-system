"""
Module các mô hình gợi ý và xếp hạng (Models: Baselines, Candidate Generators & Ranker).
Tuân thủ nghiêm ngặt:
- Tiêu chí E: Tập ứng viên toàn cục (Global Candidate Pool) giới hạn trong 30 ngày trước cutoff.
- Tiêu chí F: Có fallback cho cold users, hỗ trợ đo độ trễ suy luận.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Set, Tuple
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize


EVENT_WEIGHTS = {
    "view": 1.0,
    "cart": 3.0,
    "purchase": 5.0,
    "remove_from_cart": 0.0,
}


class BaseRecommender(ABC):
    """Lớp cơ sở cho mọi thuật toán khuyến nghị."""

    @abstractmethod
    def fit(self, history_df: pd.DataFrame, candidate_pool: Optional[Set[int]] = None) -> "BaseRecommender":
        """Huấn luyện mô hình chỉ với sự kiện trước cutoff."""
        pass

    @abstractmethod
    def recommend(self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None) -> List[int]:
        """Trả về danh sách top-K product_id được gợi ý cho user_id."""
        pass

    def recommend_with_scores(
        self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None
    ) -> List[Tuple[int, float]]:
        """Trả về danh sách top-K (product_id, score) được gợi ý cho user_id."""
        items = self.recommend(user_id, k, candidate_pool)
        return [(it, float(k - idx)) for idx, it in enumerate(items)]


class RandomRecommender(BaseRecommender):
    """
    Baseline 1: Gợi ý ngẫu nhiên từ Global Candidate Pool (Tiêu chí E).
    """

    def __init__(self, seed: int = 42):
        self.seed = seed
        self.rng = np.random.RandomState(seed)
        self.candidate_items: List[int] = []

    def fit(self, history_df: pd.DataFrame, candidate_pool: Optional[Set[int]] = None) -> "RandomRecommender":
        if candidate_pool:
            self.candidate_items = sorted(list(candidate_pool))
        else:
            self.candidate_items = sorted(list(history_df["product_id"].unique()))
        return self

    def recommend(self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None) -> List[int]:
        pool = sorted(list(candidate_pool)) if candidate_pool else self.candidate_items
        if not pool:
            return []
        if len(pool) <= k:
            return pool
        indices = self.rng.choice(len(pool), size=k, replace=False)
        return [pool[i] for i in indices]


class PopularityRecommender(BaseRecommender):
    """
    Baseline 2: Gợi ý theo độ phổ biến gần đây (Recent Popularity) trong 30 ngày.
    Điểm phổ biến = view*1 + cart*3 + purchase*5.
    """

    def __init__(self):
        self.top_items: List[int] = []
        self.item_scores: Dict[int, float] = {}

    def fit(self, history_df: pd.DataFrame, candidate_pool: Optional[Set[int]] = None) -> "PopularityRecommender":
        if history_df.empty:
            self.top_items = []
            return self

        # Tính điểm trọng số theo từng sự kiện
        df = history_df.copy()
        df["weight"] = df["event_type"].map(EVENT_WEIGHTS).fillna(0.0)

        item_scores = df.groupby("product_id")["weight"].sum()

        if candidate_pool:
            item_scores = item_scores[item_scores.index.isin(candidate_pool)]

        sorted_items = item_scores.sort_values(ascending=False)
        self.top_items = list(sorted_items.index)
        self.item_scores = sorted_items.to_dict()
        return self

    def recommend(self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None) -> List[int]:
        if candidate_pool:
            filtered = [item for item in self.top_items if item in candidate_pool]
            return filtered[:k]
        return self.top_items[:k]

    def recommend_with_scores(
        self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None
    ) -> List[Tuple[int, float]]:
        items = self.recommend(user_id, k, candidate_pool)
        return [(it, float(self.item_scores.get(it, 0.0))) for it in items]


class ContentBasedRecommender(BaseRecommender):
    """
    Baseline 3: Lọc theo nội dung (Content-Based) dựa trên category_id, brand, price.
    Không dùng category_code (Tiêu chí D).
    """

    def __init__(self, fallback_pop: Optional[PopularityRecommender] = None):
        self.fallback_pop = fallback_pop or PopularityRecommender()
        self.item_metadata: pd.DataFrame = pd.DataFrame()
        self.user_profiles: Dict[int, Dict] = {}
        self.candidate_items: List[int] = []

    def fit(self, history_df: pd.DataFrame, candidate_pool: Optional[Set[int]] = None) -> "ContentBasedRecommender":
        self.fallback_pop.fit(history_df, candidate_pool)

        if history_df.empty:
            return self

        # Lưu metadata của items (bản ghi cuối cùng)
        meta = (
            history_df.sort_values("event_time")
            .groupby("product_id")
            .last()[["category_id", "brand", "price"]]
            .reset_index()
        )
        if candidate_pool:
            meta = meta[meta["product_id"].isin(candidate_pool)]
        self.item_metadata = meta.set_index("product_id")
        self.candidate_items = list(self.item_metadata.index)

        # Xây dựng profile người dùng từ các tương tác
        df = history_df.copy()
        df["weight"] = df["event_type"].map(EVENT_WEIGHTS).fillna(0.0)

        # Trọng số theo category
        cat_weights = df.groupby(["user_id", "category_id"])["weight"].sum().unstack(fill_value=0)
        brand_weights = df.groupby(["user_id", "brand"])["weight"].sum().unstack(fill_value=0)
        avg_prices = df.groupby("user_id")["price"].mean()

        self.user_categories = cat_weights
        self.user_brands = brand_weights
        self.user_avg_prices = avg_prices.to_dict()

        # Tiền lập chỉ mục category, brand và price để tăng tốc truy vấn O(1)
        self.item_prices = self.item_metadata["price"].values.astype(np.float32)
        cat_series = self.item_metadata["category_id"].values
        self.cat_to_indices = {}
        for idx, c in enumerate(cat_series):
            if c not in self.cat_to_indices:
                self.cat_to_indices[c] = []
            self.cat_to_indices[c].append(idx)
        self.cat_to_indices = {c: np.array(idx_list, dtype=np.int32) for c, idx_list in self.cat_to_indices.items()}

        brand_series = self.item_metadata["brand"].values
        self.brand_to_indices = {}
        for idx, b in enumerate(brand_series):
            if b not in self.brand_to_indices:
                self.brand_to_indices[b] = []
            self.brand_to_indices[b].append(idx)
        self.brand_to_indices = {b: np.array(idx_list, dtype=np.int32) for b, idx_list in self.brand_to_indices.items()}

        self.user_categories_dict: Dict[int, Dict[int, float]] = {}
        for (u, c), w in df.groupby(["user_id", "category_id"])["weight"].sum().items():
            if u not in self.user_categories_dict:
                self.user_categories_dict[u] = {}
            self.user_categories_dict[u][c] = float(w)

        self.user_brands_dict: Dict[int, Dict[str, float]] = {}
        for (u, b), w in df.groupby(["user_id", "brand"])["weight"].sum().items():
            if u not in self.user_brands_dict:
                self.user_brands_dict[u] = {}
            self.user_brands_dict[u][b] = float(w)

        return self

    def recommend_with_scores(
        self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None
    ) -> List[Tuple[int, float]]:
        if user_id not in self.user_avg_prices or self.item_metadata.empty:
            return self.fallback_pop.recommend_with_scores(user_id, k, candidate_pool)

        user_price = self.user_avg_prices.get(user_id, 0)
        meta = self.item_metadata
        if candidate_pool and len(candidate_pool) < len(meta):
            meta = meta[meta.index.isin(candidate_pool)]
            if meta.empty:
                return self.fallback_pop.recommend_with_scores(user_id, k, candidate_pool)
            # Fallback nếu pool bị cắt nhỏ
            scores = np.zeros(len(meta), dtype=np.float32)
            if user_id in self.user_categories.index:
                user_cats = self.user_categories.loc[user_id]
                scores += meta["category_id"].map(user_cats).fillna(0).values * 2.0
            if user_id in self.user_brands.index:
                user_b = self.user_brands.loc[user_id]
                scores += meta["brand"].map(user_b).fillna(0).values * 1.5
            price_diff = np.abs(meta["price"].values - user_price) / (user_price + 1e-4)
            scores -= np.clip(price_diff, 0, 5) * 0.5
            top_indices = np.argsort(scores)[::-1][:k]
            recommended_with_scores = [(meta.index[idx], float(scores[idx])) for idx in top_indices]
        else:
            # Tối ưu hóa chỉ mục O(1) khi pool là toàn bộ metadata đã fit
            scores = np.zeros(len(meta), dtype=np.float32)
            user_cats = self.user_categories_dict.get(user_id, {})
            for c, w in user_cats.items():
                if c in self.cat_to_indices:
                    scores[self.cat_to_indices[c]] += w * 2.0

            user_b = self.user_brands_dict.get(user_id, {})
            for b, w in user_b.items():
                if b in self.brand_to_indices:
                    scores[self.brand_to_indices[b]] += w * 1.5

            price_diff = np.abs(self.item_prices - user_price) / (user_price + 1e-4)
            scores -= np.clip(price_diff, 0, 5) * 0.5

            if k < len(scores):
                top_part = np.argpartition(scores, -k)[-k:]
                top_indices = top_part[np.argsort(scores[top_part])[::-1]]
            else:
                top_indices = np.argsort(scores)[::-1]
            recommended_with_scores = [(meta.index[idx], float(scores[idx])) for idx in top_indices]

        # Nếu chưa đủ k, bù bằng popularity
        if len(recommended_with_scores) < k:
            seen = {it for it, _ in recommended_with_scores}
            pop_recs = self.fallback_pop.recommend_with_scores(user_id, k * 2, candidate_pool)
            for item, s in pop_recs:
                if item not in seen:
                    recommended_with_scores.append((item, float(s)))
                    seen.add(item)
                if len(recommended_with_scores) >= k:
                    break

        return recommended_with_scores[:k]

    def recommend(self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None) -> List[int]:
        return [it for it, _ in self.recommend_with_scores(user_id, k, candidate_pool)]


class ItemKNNRecommender(BaseRecommender):
    """
    Baseline 4: Lọc cộng tác Item-Item Collaborative Filtering (Cosine similarity).
    Sử dụng ma trận thưa User-Item CSR matrix, trọng số: view:1, cart:3, purchase:5.
    Mặc định top_similar_items=None (không tỉa láng giềng) để đạt NDCG@10 tối ưu (0.062416).
    """

    def __init__(self, top_similar_items: Optional[int] = None, fallback_pop: Optional[PopularityRecommender] = None):
        self.top_similar_items = top_similar_items
        self.fallback_pop = fallback_pop or PopularityRecommender()
        self.user_to_idx: Dict[int, int] = {}
        self.item_to_idx: Dict[int, int] = {}
        self.idx_to_item: Dict[int, int] = {}
        self.user_interacted_items: Dict[int, Set[int]] = {}
        self.item_similarity: Optional[np.ndarray] = None
        self.user_item_matrix: Optional[csr_matrix] = None

    def fit(self, history_df: pd.DataFrame, candidate_pool: Optional[Set[int]] = None) -> "ItemKNNRecommender":
        self.fallback_pop.fit(history_df, candidate_pool)

        if history_df.empty:
            return self

        df = history_df.copy()
        df["weight"] = df["event_type"].map(EVENT_WEIGHTS).fillna(0.0)

        # Gom nhóm tổng trọng số theo (user_id, product_id)
        ui_agg = df.groupby(["user_id", "product_id"])["weight"].sum().reset_index()

        self.user_interacted_items = (
            ui_agg.groupby("user_id")["product_id"].apply(set).to_dict()
        )

        unique_users = sorted(ui_agg["user_id"].unique())
        unique_items = sorted(ui_agg["product_id"].unique())

        self.user_to_idx = {u: i for i, u in enumerate(unique_users)}
        self.item_to_idx = {it: i for i, it in enumerate(unique_items)}
        self.idx_to_item = {i: it for i, it in enumerate(unique_items)}

        user_indices = ui_agg["user_id"].map(self.user_to_idx).values
        item_indices = ui_agg["product_id"].map(self.item_to_idx).values
        weights = ui_agg["weight"].values

        # Ma trận thưa Item x User (để tính tương đồng giữa các Item)
        item_user_matrix = csr_matrix(
            (weights, (item_indices, user_indices)),
            shape=(len(unique_items), len(unique_users)),
            dtype=np.float32,
        )

        # Lưu ma trận thưa và ma trận đã chuẩn hóa L2 để tối ưu hóa vector hóa
        self.item_user_matrix = item_user_matrix
        self.item_user_matrix_norm = normalize(item_user_matrix, norm="l2", axis=1)
        return self

    def recommend_with_scores(
        self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None
    ) -> List[Tuple[int, float]]:
        if user_id not in self.user_to_idx or user_id not in self.user_interacted_items:
            return self.fallback_pop.recommend_with_scores(user_id, k, candidate_pool)

        user_items = self.user_interacted_items[user_id]
        user_item_indices = [self.item_to_idx[it] for it in user_items if it in self.item_to_idx]

        if not user_item_indices:
            return self.fallback_pop.recommend_with_scores(user_id, k, candidate_pool)

        # Tính tổng cosine similarity với toàn bộ item
        if self.top_similar_items and self.top_similar_items < self.item_user_matrix.shape[1]:
            # Lọc giữ lại top_similar_items láng giềng có cosine lớn nhất cho mỗi item đã tương tác
            sub_vectors = self.item_user_matrix[user_item_indices]
            sims = cosine_similarity(sub_vectors, self.item_user_matrix)
            k_sim = self.top_similar_items
            partitioned_idx = np.argpartition(sims, -k_sim, axis=1)[:, -k_sim:]
            filtered_sims = np.zeros_like(sims)
            rows = np.arange(sims.shape[0])[:, None]
            filtered_sims[rows, partitioned_idx] = sims[rows, partitioned_idx]
            aggregated_scores = np.asarray(filtered_sims.sum(axis=0)).flatten()
        else:
            # Tối ưu hóa vector hóa cho unpruned ItemKNN (nhanh gấp 30-50 lần)
            u_sum = self.item_user_matrix_norm[user_item_indices].sum(axis=0)
            aggregated_scores = np.asarray(self.item_user_matrix_norm.dot(u_sum.T)).flatten()

        # Lọc theo candidate_pool
        if candidate_pool:
            valid_indices = [idx for it, idx in self.item_to_idx.items() if it in candidate_pool]
            if not valid_indices:
                return self.fallback_pop.recommend_with_scores(user_id, k, candidate_pool)
            mask = np.zeros(len(aggregated_scores), dtype=bool)
            mask[valid_indices] = True
            aggregated_scores = np.where(mask, aggregated_scores, -1.0)

        # Không gợi ý lại các item đã tương tác trong lịch sử nếu muốn, hoặc giữ lại tùy quy ước
        top_indices = np.argsort(aggregated_scores)[::-1][:k]
        recommended_with_scores = [
            (self.idx_to_item[idx], float(aggregated_scores[idx]))
            for idx in top_indices
            if aggregated_scores[idx] > 0
        ]

        # Bù bằng popularity nếu chưa đủ k
        if len(recommended_with_scores) < k:
            seen = {it for it, _ in recommended_with_scores}
            pop_recs = self.fallback_pop.recommend_with_scores(user_id, k * 2, candidate_pool)
            for it, s in pop_recs:
                if it not in seen:
                    recommended_with_scores.append((it, float(s)))
                    seen.add(it)
                if len(recommended_with_scores) >= k:
                    break

        return recommended_with_scores[:k]

    def recommend(self, user_id: int, k: int = 10, candidate_pool: Optional[Set[int]] = None) -> List[int]:
        return [it for it, _ in self.recommend_with_scores(user_id, k, candidate_pool)]


class CandidateGenerator:
    """
    Bộ sinh ứng viên đa kênh (Multi-Channel Candidate Generator):
    Tổng hợp tối đa 120 ứng viên từ:
    - Recent Popularity (top 40)
    - ItemKNN (top 50)
    - Content-Based (top 30)
    Đảm bảo fallback không rỗng cho cold user (Tiêu chí F.4).
    """

    def __init__(
        self,
        pop_model: PopularityRecommender,
        knn_model: ItemKNNRecommender,
        cb_model: ContentBasedRecommender,
        max_candidates: int = 120,
    ):
        self.pop_model = pop_model
        self.knn_model = knn_model
        self.cb_model = cb_model
        self.max_candidates = max_candidates

    def generate(self, user_id: int, candidate_pool: Optional[Set[int]] = None) -> List[int]:
        candidates: List[int] = []
        seen: Set[int] = set()

        def add_items(items: List[int], limit: int):
            added = 0
            for item in items:
                if item not in seen:
                    seen.add(item)
                    candidates.append(item)
                    added += 1
                    if added >= limit or len(candidates) >= self.max_candidates:
                        break

        # Kênh 1: ItemKNN (ưu tiên cá nhân hóa cao nhất)
        knn_items = self.knn_model.recommend(user_id, k=50, candidate_pool=candidate_pool)
        add_items(knn_items, 50)

        # Kênh 2: Content-Based
        cb_items = self.cb_model.recommend(user_id, k=30, candidate_pool=candidate_pool)
        add_items(cb_items, 30)

        # Kênh 3: Recent Popularity (bao phủ và fallback)
        pop_items = self.pop_model.recommend(user_id, k=40, candidate_pool=candidate_pool)
        add_items(pop_items, 40)

        return candidates[: self.max_candidates]
