from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.services.recommender import MODEL_VERSION, recommend, similar

app = FastAPI(title="Giftly Recommendation Service", version=MODEL_VERSION)


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


@app.get("/health")
def health() -> dict:
    return {"success": True, "service": "giftly-recommendation", "modelVersion": MODEL_VERSION}


@app.get("/model")
def model_info() -> dict:
    return {"modelVersion": MODEL_VERSION, "kind": "content-based-rule-baseline", "trained": False}


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
