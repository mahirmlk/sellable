"""Deterministic catalog access; agents may only use products returned here."""

from __future__ import annotations

import json
from pathlib import Path

from sellable.contracts import Product


class UnknownSkuError(ValueError):
    """Raised when a caller requests a SKU that does not exist in the catalog."""


class CatalogService:
    def __init__(self, products: list[Product]):
        product_by_sku = {product.sku: product for product in products}
        if len(product_by_sku) != len(products):
            raise ValueError("catalog SKUs must be unique")
        self._products = product_by_sku

    @classmethod
    def from_json(cls, path: Path) -> "CatalogService":
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls([Product.model_validate(item) for item in data])

    def get(self, sku: str) -> Product:
        try:
            return self._products[sku]
        except KeyError as error:
            raise UnknownSkuError(f"Unknown SKU: {sku}") from error

    def add_product(self, product: Product) -> Product:
        if product.sku in self._products:
            raise ValueError(f"SKU already exists: {product.sku}")
        self._products[product.sku] = product
        return product

    def search(self, query: str = "", categories: set[str] | None = None) -> list[Product]:
        normalized_query = query.strip().lower()
        category_filter = {category.lower() for category in categories or set()}
        stop_words = {"a", "an", "and", "for", "i", "in", "is", "me", "my", "need", "please", "the", "to"}
        query_terms = [
            term.strip(".,!?;:")
            for term in normalized_query.split()
            if len(term.strip(".,!?;:")) >= 3 and term.strip(".,!?;:") not in stop_words
        ]

        def score(product: Product) -> int:
            title_and_sku = " ".join((product.sku, product.title)).lower()
            searchable = f"{title_and_sku} {product.description}".lower()
            if category_filter and product.category.lower() not in category_filter:
                return 0
            if not normalized_query:
                return 1
            if normalized_query in searchable:
                return len(query_terms) * 3 + 1
            return sum(
                3 if term in title_and_sku else 1 if term in searchable else 0
                for term in query_terms
            )

        ranked = sorted(
            ((score(product), product) for product in self._products.values()),
            key=lambda match: match[0],
            reverse=True,
        )
        return [product for score_value, product in ranked if score_value > 0]

    def all(self) -> list[Product]:
        return list(self._products.values())
