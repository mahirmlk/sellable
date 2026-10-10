"""Connector sync service: registry CRUD plus catalog sync runs that
normalize source records into canonical Products and upsert them.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sellable.connectors.base import BaseConnector, ConnectorConfig, ConnectorHealth
from sellable.connectors.rest import RestConnector


_PROVIDERS: dict[str, type[BaseConnector]] = {
    "custom_rest": RestConnector,
}


def connector_for(config: ConnectorConfig, *, fetcher=None) -> BaseConnector:
    cls = _PROVIDERS.get(config.provider)
    if cls is None:
        raise ValueError(f"Unknown connector provider: {config.provider}")
    return cls(config, fetcher=fetcher)


class ConnectorService:
    def __init__(self, connector_repo, catalog_repo) -> None:
        self._connectors = connector_repo
        self._catalog = catalog_repo

    def register(self, config: ConnectorConfig) -> dict:
        return self._connectors.save(config)

    def get(self, connector_id: str, merchant_id: str) -> dict | None:
        return self._connectors.get(connector_id, merchant_id)

    def list_for_merchant(self, merchant_id: str) -> list[dict]:
        return self._connectors.list_for_merchant(merchant_id)

    def remove(self, connector_id: str, merchant_id: str) -> bool:
        return self._connectors.delete(connector_id, merchant_id)

    def health(self, connector_id: str, merchant_id: str) -> ConnectorHealth:
        config = self._require_config(connector_id, merchant_id)
        return connector_for(config).health()

    def sync_catalog(
        self, connector_id: str, merchant_id: str, *, limit: int = 500, fetcher=None
    ) -> dict[str, object]:
        """Pull → normalize → upsert. Returns counts plus failures.
        Failures raise (the caller ledgers them); partial upserts never
        happen — normalize-then-write keeps catalog writes atomic per run."""
        config = self._require_config(connector_id, merchant_id)
        connector = connector_for(config, fetcher=fetcher)
        products = [
            product.model_copy(update={"merchant_id": merchant_id})
            for product in connector.fetch_products(merchant_id, limit=limit)
        ]
        counts = self._catalog.upsert_many(products)
        self._connectors.touch_sync(connector_id, merchant_id, status="OK")
        return {
            "connector_id": connector_id,
            "provider": config.provider,
            **counts,
            "total": len(products),
        }

    def _require_config(self, connector_id: str, merchant_id: str) -> ConnectorConfig:
        row = self._connectors.get(connector_id, merchant_id)
        if row is None:
            raise ValueError(f"Unknown connector: {connector_id}")
        if not row.get("active", True):
            raise ValueError(f"Connector is disabled: {connector_id}")
        return ConnectorConfig(**{k: v for k, v in row.items() if k != "last_sync"})


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
