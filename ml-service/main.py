# -*- coding: utf-8 -*-
from contextlib import asynccontextmanager
from typing import Any, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.services.ranker_service import RankerService
from app.services.recommender import MODEL_VERSION, recommend, similar

# Biến dịch vụ toàn cục nạp một lần lúc khởi động
ranker_service: Optional[RankerService] = None


def init_service(
    model_path: str = "models/ranker_best_model.pkl",
    data_path: str = "data/processed/ranker_val_full.parquet",
) -> RankerService:
    global ranker_service
    if ranker_service is None:
        ranker_service = RankerService(model_path=model_path, data_path=data_path)
    return ranker_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_service()
    yield


app = FastAPI(
    title="Giftly Recommendation Service",
    version="2.0.0",
    lifespan=lifespan,
)


# ============================================================================
# Request / Response Schemas
# ============================================================================

class RankRequest(BaseModel):
    user_id: Optional[int] = None
    session_id: Optional[str] = None
    top_k: int = Field(default=10, ge=1, le=500)
    candidate_ids: Optional[List[int]] = None


class Product(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=4000)
    status: str = Field(default="ACTIVE", max_length=20)
    stock: int = Field(default=0, ge=0)
    price: float = Field(default=0, ge=0)
    categoryId: str | int | None = None
    occasionTags: list[str] = Field(default_factory=list, max_length=40)
    recipientTags: list[str] = Field(default_factory=list, max_length=40)
    interestTags: list[str] = Field(default_factory=list, max_length=40)
    style: str | None = Field(default=None, max_length=80)
    giftType: str | None = Field(default=None, max_length=80)
    isFeatured: bool = False
    popularityScore: float = Field(default=0, ge=0, le=1)
    ratingScore: float = Field(default=0, ge=0, le=1)


class RecommendationRequest(BaseModel):
    products: list[Product] = Field(max_length=500)
    preferences: dict[str, dict[str, float]] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=12, ge=1, le=50)


class SimilarRequest(BaseModel):
    target: Product
    products: list[Product] = Field(max_length=500)
    limit: int = Field(default=12, ge=1, le=50)


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/health")
def health() -> dict:
    """
    Kiểm tra trạng thái dịch vụ, trả về model version và mã băm SHA-256 của file .pkl đang nạp.
    """
    srv = ranker_service or init_service()
    return {
        "status": "healthy",
        "service": "giftly-recommendation",
        "modelVersion": srv.model_version,
        "modelSha256": srv.model_sha256,
        "totalUsersLoaded": len(srv.user_groups),
        "candidatePoolSize": srv.candidate_pool_size,
    }


@app.post("/recommend/rank")
def recommend_rank(request: RankRequest) -> dict:
    """
    Xếp hạng danh sách sản phẩm cho người dùng bằng mô hình Ranker LC-1 (LightGBM).
    - Nhận: user_id (hoặc session_id), top_k, tùy chọn candidate_ids.
    - Trả về: danh sách sản phẩm kèm điểm số, nguồn ứng viên và lý do gợi ý nổi bật.
    - Người dùng cold / không đủ lịch sử: tự động chuyển sang fallback Popularity.
    """
    srv = ranker_service or init_service()
    return srv.rank(
        user_id=request.user_id,
        top_k=request.top_k,
        candidate_ids=request.candidate_ids,
    )


# ============================================================================
# Legacy Endpoints (Tương thích ngược với Frontend và Gift Finder)
# ============================================================================

@app.get("/model")
def model_info() -> dict:
    srv = ranker_service or init_service()
    return {
        "modelVersion": srv.model_version,
        "kind": "lightgbm-ranker-lc1",
        "trained": True,
        "modelSha256": srv.model_sha256,
    }


@app.post("/recommendations")
def recommendations(request: RecommendationRequest) -> dict:
    products = [item.model_dump() for item in request.products]
    result = recommend(products, request.preferences, request.context)
    result["items"] = result["items"][: request.limit]
    return result


@app.post("/gift-finder")
def gift_finder(request: RecommendationRequest) -> dict:
    return recommendations(request)


@app.post("/similar")
def similar_products(request: SimilarRequest) -> dict:
    return similar(request.target.model_dump(), [item.model_dump() for item in request.products], request.limit)
