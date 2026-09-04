"""Checkout session durability: one ACTIVE row per merchant+buyer, owned
reads/writes, lifecycle transitions, and message caps. The session row is a
pointer (transcript + quote snapshot + order link) — money state always comes
from the linked order, never from this row."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.config import Settings
from sellable.contracts import CheckoutSessionStatus
from sellable.ledger.database import Base
from sellable.main import app, get_checkout_repo
from sellable.repositories import CheckoutSessionRepository

import sellable.merchant_auth as merchant_auth

DEMO_H = {"X-Agent-Key": "sellable_demo_key_001"}


@pytest.fixture
def session_repo():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CheckoutSessionRepository(engine)


@pytest.fixture
def client(session_repo, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    app.dependency_overrides[get_checkout_repo] = lambda: session_repo
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def snapshot(**overrides):
    body: dict[str, object] = {"buyer_ref": "human_chat"}
    body.update(overrides)
    return body


def test_missing_session_is_404_not_error(client: TestClient) -> None:
    response = client.get("/console/checkout/session", headers=DEMO_H)
    assert response.status_code == 404
    assert response.json()["detail"] == "no_active_session"


def test_create_then_restore_round_trip(client: TestClient) -> None:
    created = client.post(
        "/console/checkout/session",
        json=snapshot(
            budget_paise=1_500_000,
            message="I need an office chair under 15K",
            trace_id="trc_" + "a" * 32,
            cart={"items": [{"sku": "CHAIR-PRO-01"}], "total_paise": 1_299_900},
            decision={"action": "NEEDS_HUMAN_APPROVAL", "verdict": "NEEDS_HUMAN_APPROVAL"},
            messages=[{"role": "user", "text": "I need an office chair under 15K"}],
        ),
        headers=DEMO_H,
    )
    assert created.status_code == 200
    first_id = created.json()["session_id"]
    assert created.json()["status"] == "ACTIVE"

    restored = client.get("/console/checkout/session", headers=DEMO_H)
    assert restored.status_code == 200
    body = restored.json()
    assert body["session_id"] == first_id
    assert body["budget_paise"] == 1_500_000
    assert body["message"] == "I need an office chair under 15K"
    assert body["cart"]["total_paise"] == 1_299_900
    assert body["decision"]["action"] == "NEEDS_HUMAN_APPROVAL"
    assert body["messages"][0]["text"] == "I need an office chair under 15K"


def test_double_create_collapses_to_single_active(client: TestClient) -> None:
    first = client.post(
        "/console/checkout/session", json=snapshot(message="one"), headers=DEMO_H
    )
    second = client.post(
        "/console/checkout/session", json=snapshot(message="two"), headers=DEMO_H
    )
    assert first.json()["session_id"] == second.json()["session_id"]
    assert second.json()["message"] == "two"


def test_order_link_advances_lifecycle(client: TestClient) -> None:
    created = client.post(
        "/console/checkout/session", json=snapshot(), headers=DEMO_H
    ).json()
    updated = client.post(
        "/console/checkout/session",
        json={"session_id": created["session_id"], "order_id": "ord_session_01"},
        headers=DEMO_H,
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "ORDER_PLACED"
    assert updated.json()["order_id"] == "ord_session_01"


def test_close_then_fresh_session(client: TestClient) -> None:
    created = client.post(
        "/console/checkout/session", json=snapshot(), headers=DEMO_H
    ).json()
    closed = client.post(
        f"/console/checkout/session/{created['session_id']}/close", headers=DEMO_H
    )
    assert closed.status_code == 200
    assert closed.json()["status"] == "ABANDONED"

    # Closed rows reject writes; the next save starts a brand-new session.
    conflict = client.post(
        "/console/checkout/session",
        json={"session_id": created["session_id"], "message": "late"},
        headers=DEMO_H,
    )
    assert conflict.status_code == 409
    fresh = client.post(
        "/console/checkout/session", json=snapshot(message="new"), headers=DEMO_H
    )
    assert fresh.json()["session_id"] != created["session_id"]
    assert fresh.json()["status"] == "ACTIVE"


def test_foreign_session_id_is_404(client: TestClient) -> None:
    assert (
        client.post(
            "/console/checkout/session",
            json={"session_id": "sess_no_such_row", "message": "x"},
            headers=DEMO_H,
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/console/checkout/session/sess_no_such_row/close", headers=DEMO_H
        ).status_code
        == 404
    )


def test_messages_capped_at_200(session_repo: CheckoutSessionRepository) -> None:
    from sellable.contracts import CheckoutSession

    data = CheckoutSession(
        merchant_id="mrc_cap",
        buyer_ref="human_chat",
        messages=[
            {"role": "user", "text": f"m{i}"} for i in range(250)  # type: ignore[list-item]
        ],
    )
    saved = session_repo.save(data)
    assert len(saved.messages) == 250  # contract object untouched
    stored = session_repo.get(saved.session_id)
    assert stored is not None
    assert len(stored.messages) == 200
    assert stored.messages[0].text == "m50"


# ---------------------------------------------------------------------------
# Chat history: list / open / archive / delete
# ---------------------------------------------------------------------------


@pytest.fixture
def history_stack(monkeypatch: pytest.MonkeyPatch):
    """Shared in-memory engine across session + order repos, wired into the app."""
    from sellable.main import get_order_repo
    from sellable.repositories import OrderRepository

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = CheckoutSessionRepository(engine)
    orders = OrderRepository(engine)
    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    app.dependency_overrides[get_checkout_repo] = lambda: sessions
    app.dependency_overrides[get_order_repo] = lambda: orders
    try:
        with TestClient(app) as c:
            yield c, sessions, orders
    finally:
        app.dependency_overrides.clear()


def _make_order(orders, *, order_id: str, amount: int = 69_900) -> None:
    from sellable.contracts import Order
    from sellable.contracts import OrderStatus

    orders.save(
        Order(
            order_id=order_id,
            trace_id=f"trc_{order_id}",
            quote_id=f"cart_{order_id}",
            buyer_agent_id="buyer_hist",
            merchant_id="mrc_demo_store",
            amount_paise=amount,
            status=OrderStatus.PAID,
            idempotency_key=f"idem_hist_key_{order_id}",
        )
    )


def test_history_list_is_lightweight_and_newest_first(history_stack) -> None:
    client, _, _ = history_stack
    # Same-buyer POSTs upsert ONE active row by design, so close each one to
    # build real history depth.
    ids = []
    for text in ("first query", "second query", "third query"):
        response = client.post(
            "/console/checkout/session",
            json=snapshot(
                message=text,
                messages=[{"role": "user", "text": text}],
                cart={"items": [{"sku": "X"}], "total_paise": 100},
            ),
            headers=DEMO_H,
        )
        assert response.status_code == 200
        ids.append(response.json()["session_id"])
        client.post(
            f"/console/checkout/session/{response.json()['session_id']}/close",
            headers=DEMO_H,
        )

    listed = client.get("/console/checkout/sessions", headers=DEMO_H)
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) == 3
    # Newest first.
    assert rows[0]["message"] == "third query"
    # Lightweight shape only — no transcript/cart/decision blobs.
    assert set(rows[0].keys()) == {
        "session_id",
        "title",
        "status",
        "archived",
        "created_at",
        "updated_at",
        "order_id",
        "trace_id",
        "budget_paise",
        "message",
        "message_count",
        "order_status",
        "amount_paise",
        "approval_pending",
    }
    assert rows[0]["message_count"] == 1


def test_history_pagination(history_stack) -> None:
    client, _, _ = history_stack
    for i in range(5):
        created = client.post(
            "/console/checkout/session", json=snapshot(message=f"q{i}"), headers=DEMO_H
        )
        client.post(
            f"/console/checkout/session/{created.json()['session_id']}/close",
            headers=DEMO_H,
        )
    page1 = client.get("/console/checkout/sessions?limit=2", headers=DEMO_H).json()
    page2 = client.get("/console/checkout/sessions?limit=2&offset=2", headers=DEMO_H).json()
    page3 = client.get("/console/checkout/sessions?limit=2&offset=4", headers=DEMO_H).json()
    assert [r["message"] for r in page1] == ["q4", "q3"]
    assert [r["message"] for r in page2] == ["q2", "q1"]
    assert [r["message"] for r in page3] == ["q0"]


def test_open_by_id_and_foreign_is_404(history_stack) -> None:
    from sellable.contracts import CheckoutSession

    client, sessions, _ = history_stack
    mine = client.post(
        "/console/checkout/session", json=snapshot(message="mine"), headers=DEMO_H
    ).json()
    opened = client.get(
        f"/console/checkout/session/{mine['session_id']}", headers=DEMO_H
    )
    assert opened.status_code == 200
    assert opened.json()["message"] == "mine"

    assert (
        client.get("/console/checkout/session/sess_no_such_row", headers=DEMO_H).status_code
        == 404
    )
    # Another merchant's row is indistinguishable from missing (no oracle).
    sessions.save(
        CheckoutSession(merchant_id="mrc_someone_else", buyer_ref="human_chat")
    )
    foreign = sessions.active_for("mrc_someone_else", "human_chat")
    assert foreign is not None
    assert (
        client.get(
            f"/console/checkout/session/{foreign.session_id}", headers=DEMO_H
        ).status_code
        == 404
    )


def test_archive_hide_unhide_and_delete_preserves_commerce(history_stack) -> None:
    client, sessions, orders = history_stack
    _make_order(orders, order_id="ord_hist_01")
    linked = client.post(
        "/console/checkout/session",
        json=snapshot(message="linked", order_id="ord_hist_01"),
        headers=DEMO_H,
    ).json()
    plain = client.post(
        "/console/checkout/session",
        json=snapshot(message="plain"),
        headers=DEMO_H,
    ).json()
    assert linked["session_id"] != plain["session_id"]

    listed = client.get("/console/checkout/sessions", headers=DEMO_H).json()
    assert {r["session_id"] for r in listed} == {
        linked["session_id"],
        plain["session_id"],
    }
    # Linked order enrichment comes along.
    linked_row = next(r for r in listed if r["session_id"] == linked["session_id"])
    assert linked_row["order_status"] == "PAID"
    assert linked_row["amount_paise"] == 69_900

    archived = client.patch(
        f"/console/checkout/session/{plain['session_id']}",
        json={"archived": True},
        headers=DEMO_H,
    )
    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    default_list = client.get("/console/checkout/sessions", headers=DEMO_H).json()
    assert {r["session_id"] for r in default_list} == {linked["session_id"]}
    full_list = client.get(
        "/console/checkout/sessions?include_archived=true", headers=DEMO_H
    ).json()
    assert {r["session_id"] for r in full_list} == {
        linked["session_id"],
        plain["session_id"],
    }

    unarchived = client.patch(
        f"/console/checkout/session/{plain['session_id']}",
        json={"archived": False},
        headers=DEMO_H,
    )
    assert unarchived.json()["archived"] is False

    deleted = client.delete(
        f"/console/checkout/session/{linked['session_id']}", headers=DEMO_H
    )
    assert deleted.status_code == 200
    assert deleted.json()["archived"] is True
    # Commerce records are untouched by chat deletion.
    assert orders.get("ord_hist_01") is not None
    remaining = client.get("/console/checkout/sessions", headers=DEMO_H).json()
    assert {r["session_id"] for r in remaining} == {plain["session_id"]}


def test_title_derivation_and_override(history_stack) -> None:
    client, _, _ = history_stack
    long_text = "I need an office chair under fifteen thousand rupees please thank you"
    created = client.post(
        "/console/checkout/session",
        json=snapshot(
            message=long_text,
            messages=[
                {"role": "system", "text": "hello"},
                {"role": "user", "text": long_text},
            ],
        ),
        headers=DEMO_H,
    ).json()
    assert created["title"] == long_text[:48]

    renamed = client.patch(
        f"/console/checkout/session/{created['session_id']}",
        json={"title": "Chair purchase"},
        headers=DEMO_H,
    )
    assert renamed.json()["title"] == "Chair purchase"

    cleared = client.patch(
        f"/console/checkout/session/{created['session_id']}",
        json={"title": "   "},
        headers=DEMO_H,
    )
    assert cleared.json()["title"] is None


def test_reads_never_create_sessions(history_stack) -> None:
    client, _, _ = history_stack
    assert client.get("/console/checkout/sessions", headers=DEMO_H).json() == []
    assert (
        client.get("/console/checkout/session/sess_nothing", headers=DEMO_H).status_code
        == 404
    )
    assert client.get("/console/checkout/sessions", headers=DEMO_H).json() == []
