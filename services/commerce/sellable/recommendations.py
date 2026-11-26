"""Recommendation service (target §19.3, §19.4).

A separate deterministic service — never LLM memory. Candidate generators:
merchant-curated ``upsell_sku`` chains, same-category availability, then
category breadth. Every candidate passes the §19.4 safety filter before it
is returned: in stock, within the merchant's allowed categories, and never
the source product. Unavailable or prohibited products are dropped, not
shown — a recommendation engine that cannot verify availability recommends
nothing rather than fabricating.
"""

from __future__ import annotations

from sellable.catalog import CatalogService
from sellable.contracts import MerchantPolicy, Product


class RecommendationService:
    def __init__(self, catalog: CatalogService, *, policy: MerchantPolicy) -> None:
        self._catalog = catalog
        self._policy = policy

    def for_product(
        self, sku: str, *, limit: int = 3, customer_id: str | None = None
    ) -> list[Product]:
        """Ranked, safety-filtered alternatives for a source product."""
        try:
            source = self._catalog.get(sku)
        except Exception:  # noqa: BLE001 — unknown SKU recommends nothing
            return []
        allowed = set(self._policy.allowed_categories)

        candidates: list[Product] = []
        seen: set[str] = {source.sku}

        def _admit(product: Product) -> bool:
            """§19.4 safety filter: availability + policy constraints."""
            if product.sku in seen:
                return False
            if product.stock <= 0:
                return False
            if allowed and product.category not in allowed:
                return False
            return True

        # 1. Merchant-curated chain (attributes.upsell_sku), one hop deep:
        # a curated companion is the strongest signal the merchant gave us.
        for curated_sku in self._curated_chain(source, depth=2):
            try:
                candidate = self._catalog.get(curated_sku)
            except Exception:  # noqa: BLE001 — dangling curation never breaks discovery
                continue
            if _admit(candidate):
                candidates.append(candidate)
                seen.add(candidate.sku)
            if len(candidates) >= limit:
                return candidates

        # 2. Same-category availability next: closest substitute.
        for item in self._catalog.search("", {source.category}):
            if _admit(item):
                candidates.append(item)
                seen.add(item.sku)
            if len(candidates) >= limit:
                return candidates

        # 3. Category breadth from the merchant's allowed set.
        for category in self._policy.allowed_categories:
            if category == source.category:
                continue
            for item in self._catalog.search("", {category}):
                if _admit(item):
                    candidates.append(item)
                    seen.add(item.sku)
                if len(candidates) >= limit:
                    return candidates
        return candidates

    def _curated_chain(self, source: Product, *, depth: int = 2) -> list[str]:
        """Follow merchant-curated upsell links breadth-first, bounded."""
        chain: list[str] = []
        frontier = [source]
        visited = {source.sku}
        for _ in range(depth):
            nxt: list[Product] = []
            for product in frontier:
                up = product.attributes.get("upsell_sku")
                if isinstance(up, str) and up not in visited:
                    chain.append(up)
                    visited.add(up)
                    try:
                        nxt.append(self._catalog.get(up))
                    except Exception:  # noqa: BLE001 — dangling curation
                        continue
            frontier = nxt
            if not frontier:
                break
        return chain
