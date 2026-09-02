"""Per-merchant commerce cores built from real database records.

Every merchant (including the demo store) is a real row in the ``merchants``
table with its own catalog (``catalog_products``) and policy (``policy``).
Cores are cached per merchant and invalidated when the merchant updates their
catalog or policy. Nothing here fabricates data: an unknown merchant simply
has an empty catalog and default policy until the merchant creates content.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sellable.catalog import CatalogService
from sellable.contracts import MerchantPolicy, Product
from sellable.core import CommerceCore
from sellable.ledger.database import make_engine
from sellable.ledger.service import LedgerRepository
from sellable.repositories import CatalogRepository, MerchantRepository

DEMO_MERCHANT_ID = "mrc_demo_store"

# Sensible starting policy for a newly onboarded merchant (mirrors the demo
# store's guardrails; the merchant can change every value from the console).
DEFAULT_POLICY: dict[str, object] = {
    "currency": "INR",
    "max_order_value_paise": 500000,
    "max_single_item_value_paise": 300000,
    "max_discount_percent": 10,
    "allowed_categories": ["accessories", "gifting", "snacks"],
    "max_negotiation_rounds": 5,
    "max_upsells_per_session": 1,
    "human_approval_threshold_paise": 200000,
}


def repository_root() -> Path:
    from sellable.core import repository_root

    return repository_root()


def new_merchant_id() -> str:
    return f"mrc_{uuid.uuid4().hex[:12]}"


def load_policy_for(merchant_id: str, engine: object | None = None) -> MerchantPolicy:
    """Load the merchant's persisted policy; fall back to defaults if none."""
    from sqlalchemy.orm import Session

    from sellable.ledger.database import PolicyRecord

    engine = engine or make_engine()
    with Session(engine) as session:
        record = session.get(PolicyRecord, merchant_id)
        if record and isinstance(record.policy_json, dict):
            data = dict(record.policy_json)
            data["merchant_id"] = merchant_id
            return MerchantPolicy.model_validate(data)
    return MerchantPolicy.model_validate({"merchant_id": merchant_id, **DEFAULT_POLICY})


def save_policy_for(policy: MerchantPolicy, engine: object | None = None) -> None:
    from sqlalchemy.orm import Session

    from sellable.ledger.database import PolicyRecord

    engine = engine or make_engine()
    with Session(engine) as session:
        existing = session.get(PolicyRecord, policy.merchant_id)
        if existing:
            existing.policy_json = policy.model_dump()
        else:
            session.add(
                PolicyRecord(merchant_id=policy.merchant_id, policy_json=policy.model_dump())
            )
        session.commit()


def seed_demo_catalog_if_empty(engine: object | None = None) -> None:
    """Persist the demo seed catalog as real DB records (once).

    The demo merchant is a real database record; its seed products are written
    into ``catalog_products`` so the agent gateway serves the same data the
    console shows. This runs only when the demo merchant's catalog is empty.
    """
    catalog_repo = CatalogRepository(engine=engine)
    if catalog_repo.list(DEMO_MERCHANT_ID):
        return
    seed_path = repository_root() / "infra" / "seed" / "catalog.json"
    if not seed_path.is_file():
        return
    products = [Product.model_validate(item) for item in json.loads(seed_path.read_text(encoding="utf-8"))]
    catalog_repo.add_many(products)


class MerchantRegistry:
    """Caches one CommerceCore per merchant, built from real DB records."""

    def __init__(self, ledger: LedgerRepository | None = None, engine: object | None = None) -> None:
        self._ledger = ledger or LedgerRepository()
        self._engine = engine
        self._cores: dict[str, CommerceCore] = {}
        self._lock = threading.Lock()

    def get(self, merchant_id: str) -> CommerceCore:
        with self._lock:
            core = self._cores.get(merchant_id)
            if core is not None:
                return core
        catalog = CatalogService(CatalogRepository(engine=self._engine).list(merchant_id))
        policy = load_policy_for(merchant_id, engine=self._engine)
        core = CommerceCore(
            catalog=catalog,
            policy=policy,
            ledger=self._ledger,
            merchant_scope=merchant_id,
            engine=self._engine,
        )
        with self._lock:
            # Another thread may have built it meanwhile; keep the first.
            core = self._cores.setdefault(merchant_id, core)
        return core

    def invalidate(self, merchant_id: str) -> None:
        """Drop the cached core so the next access reloads catalog/policy."""
        with self._lock:
            self._cores.pop(merchant_id, None)

    def ensure_demo_merchant(self) -> None:
        """The demo store is a real DB record used by the agent gateway."""
        repo = MerchantRepository(engine=self._engine)
        if repo.get(DEMO_MERCHANT_ID) is None:
            repo.create(DEMO_MERCHANT_ID, "SELLABLE Demo Store")
        seed_demo_catalog_if_empty(engine=self._engine)

    def create_merchant(self, *, name: str) -> tuple[str, MerchantPolicy]:
        """Create a real merchant record with a default policy row."""
        merchant_id = new_merchant_id()
        MerchantRepository(engine=self._engine).create(merchant_id, name)
        policy = MerchantPolicy.model_validate({"merchant_id": merchant_id, **DEFAULT_POLICY})
        save_policy_for(policy, engine=self._engine)
        return merchant_id, policy
