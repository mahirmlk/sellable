"""Connector base types: every source system speaks this interface, so
the sync engine never learns provider specifics.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ConnectorHealth:
    ok: bool
    detail: str = ""
    latency_ms: int = 0


@dataclass
class ConnectorConfig:
    """Non-secret connector configuration (secrets live in env/secret
    manager, never in this row)."""

    connector_id: str
    merchant_id: str
    kind: str = "commerce"  # commerce|inventory|order|customer
    provider: str = "custom_rest"
    base_url: str = ""
    products_path: str = "/products"
    field_map: dict = field(default_factory=dict)
    headers: dict = field(default_factory=dict)
    timeout_seconds: int = 15
    active: bool = True


class ConnectorError(RuntimeError):
    pass


class BaseConnector:
    """Source-system adapter. Subclasses implement fetch; normalization
    into canonical Products is shared here."""

    provider: str = "base"

    def __init__(self, config: ConnectorConfig, *, fetcher=None) -> None:
        self.config = config
        self._fetcher = fetcher or self._default_fetcher()

    def health(self) -> ConnectorHealth:
        """Probe the source system. Never raises — reports instead."""
        import time

        started = time.perf_counter()
        try:
            self.fetch_raw(limit=1)
            return ConnectorHealth(
                ok=True, latency_ms=int((time.perf_counter() - started) * 1000)
            )
        except Exception as error:  # noqa: BLE001 — health is a report
            return ConnectorHealth(ok=False, detail=str(error)[:300])

    def fetch_raw(self, *, limit: int = 500) -> list[dict]:
        """Raw source records. Implemented by subclasses."""
        raise NotImplementedError

    def fetch_products(self, merchant_id: str, *, limit: int = 500) -> list:
        """Normalized canonical products for the merchant."""
        from sellable.contracts import Product

        products = []
        for record in self.fetch_raw(limit=limit):
            products.append(self.normalize(record, merchant_id))
        return products

    def normalize(self, record: dict, merchant_id: str):
        """Map one source record onto the canonical Product (§18.1)."""
        from sellable.contracts import Product

        field_map = self.config.field_map or {}
        def mapped(*names: str, default=None):
            for name in names:
                key = field_map.get(name, name)
                if key in record and record[key] not in (None, ""):
                    return record[key]
            return default

        price = int(mapped("price_paise", "price", default=0))
        floor = mapped("floor_paise", "floor", default=None)
        title = str(mapped("title", "name", default="Untitled"))
        description = str(mapped("description", "body", default="") or title)
        return Product(
            merchant_id=merchant_id,
            sku=str(mapped("sku", "id", "code")),
            title=title,
            description=description,
            price_paise=price,
            floor_paise=int(floor) if floor is not None else max(price * 80 // 100, 1),
            stock=int(mapped("stock", "inventory", "quantity", default=0)),
            category=str(mapped("category", "type", default="general")),
            attributes={
                k: v for k, v in record.items()
                if k not in ("sku", "id", "code", "title", "name")
            },
        )

    def _default_fetcher(self):
        return None
