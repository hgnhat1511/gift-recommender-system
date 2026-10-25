from typing import Any

MODEL_VERSION = "giftly-content-baseline-1"
TAG_GROUPS = ("categories", "occasions", "recipients", "interests", "styles", "giftTypes")


def _normal(value: Any) -> str:
    return str(value or "").strip().casefold()


def _tags(product: dict, key: str) -> list[str]:
    value = product.get(key) or []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in value if isinstance(item, (str, int, float))]


def _matches_query(product: dict, query: str) -> bool:
    searchable = " ".join([
        str(product.get("name") or ""),
        str(product.get("description") or ""),
        *(_tags(product, "occasionTags") + _tags(product, "recipientTags") + _tags(product, "interestTags")),
    ]).casefold()
    return query in searchable


def _score(product: dict, preferences: dict, context: dict | None = None) -> tuple[float, list[str]]:
    score = 0.0
    reasons: list[str] = []
    context = context or {}
    fields = {
        "categories": ("categoryId", "categoryName", 4.0, "Phù hợp danh mục"),
        "occasions": ("occasionTags", "", 1.5, "Đúng dịp"),
        "recipients": ("recipientTags", "", 1.5, "Đúng người nhận"),
        "interests": ("interestTags", "", 2.0, "Đúng sở thích"),
        "styles": ("style", "", 1.5, "Đúng phong cách"),
        "giftTypes": ("giftType", "", 1.5, "Đúng loại quà"),
    }
    for group, (field, _unused, weight, label) in fields.items():
        wanted = preferences.get(group) or {}
        values = _tags(product, field) if field.endswith("Tags") else [str(product.get(field))] if product.get(field) else []
        if group == "categories" and product.get("categoryId") is not None:
            values.append(str(product["categoryId"]))
        matches = [(key, float(value)) for key, value in wanted.items() if any(_normal(key) == _normal(item) for item in values)]
        if group == "occasions" and context.get("occasion") and any(_normal(context["occasion"]) == _normal(item) for item in values):
            matches.append((str(context["occasion"]), 1.0))
        if group == "recipients" and context.get("recipient") and any(_normal(context["recipient"]) == _normal(item) for item in values):
            matches.append((str(context["recipient"]), 1.0))
        for match, strength in sorted(matches, key=lambda pair: pair[1], reverse=True)[:2]:
            score += weight * max(0.0, min(strength, 1.0))
            reasons.append(f"{label}: {match}")
    query = _normal(context.get("query"))
    if query:
        if _matches_query(product, query):
            score += 2.0
            reasons.append(f"Khớp nội dung: {query}")
    score += 0.25 * float(product.get("popularityScore") or 0)
    score += 0.1 * float(product.get("ratingScore") or 0)
    if product.get("isFeatured"):
        score += 0.15
        if not reasons:
            reasons.append("Được cửa hàng giới thiệu")
    return score, reasons or ["Sản phẩm còn hàng trong catalog"]


def recommend(products: list[dict], preferences: dict | None = None, context: dict | None = None) -> dict:
    preferences = preferences or {}
    context = context or {}
    budget = context.get("budget")
    query = _normal(context.get("query"))
    candidates = []
    for product in products:
        if _normal(product.get("status", "ACTIVE")) != "active" or int(product.get("stock", 0)) <= 0:
            continue
        if budget is not None and float(product.get("price", 0)) > float(budget):
            continue
        if query and not _matches_query(product, query):
            continue
        score, reasons = _score(product, preferences, context)
        candidates.append({"id": str(product["id"]), "score": round(score, 6), "reasons": reasons})
    candidates.sort(key=lambda item: (-item["score"], item["id"]))
    return {"method": "content_baseline" if any(preferences.values()) or context else "popular_cold_start", "modelVersion": MODEL_VERSION, "items": candidates}


def similar(target: dict, products: list[dict], limit: int = 12) -> dict:
    target_groups = {
        "categories": { _normal(target.get("categoryId")) } if target.get("categoryId") is not None else set(),
        "occasions": {_normal(item) for item in _tags(target, "occasionTags")},
        "recipients": {_normal(item) for item in _tags(target, "recipientTags")},
        "interests": {_normal(item) for item in _tags(target, "interestTags")},
        "styles": {_normal(target.get("style"))} if target.get("style") else set(),
        "giftTypes": {_normal(target.get("giftType"))} if target.get("giftType") else set(),
    }
    result = []
    for product in products:
        if str(product.get("id")) == str(target.get("id")) or _normal(product.get("status", "ACTIVE")) != "active" or int(product.get("stock", 0)) <= 0:
            continue
        groups = {
            "categories": {_normal(product.get("categoryId"))} if product.get("categoryId") is not None else set(),
            "occasions": {_normal(item) for item in _tags(product, "occasionTags")},
            "recipients": {_normal(item) for item in _tags(product, "recipientTags")},
            "interests": {_normal(item) for item in _tags(product, "interestTags")},
            "styles": {_normal(product.get("style"))} if product.get("style") else set(),
            "giftTypes": {_normal(product.get("giftType"))} if product.get("giftType") else set(),
        }
        shared = [name for name in TAG_GROUPS if target_groups[name] & groups[name]]
        result.append({"id": str(product["id"]), "score": len(shared), "reasons": [f"Cùng thuộc tính {name}" for name in shared]})
    result.sort(key=lambda item: (-item["score"], item["id"]))
    return {"method": "content_similarity", "modelVersion": MODEL_VERSION, "items": result[:limit]}
