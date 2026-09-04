"""Regression tests for the Activity SSE/event path freeze fix.

Root cause covered here: RequestBodyCaptureMiddleware used to answer every
post-body ``receive()`` with a synthetic empty ``http.request``, which
swallowed ``http.disconnect`` forever — the server could never observe a
closed browser connection, so SSE streams accumulated without bound, each
polling the database every second until restart.

Covers: disconnect propagation through the middleware, stream termination +
registry drain on disconnect, concurrent responsiveness while a stream is
open, and shared engine-pool reuse. No mocks of commerce logic: a real
in-memory ledger backs the stream, and the demo-key dev session follows the
existing dashboard-test pattern.
"""

import asyncio
import time

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import sellable.main as main_module
from sellable.config import Settings
from sellable.contracts import LedgerActor, LedgerEvent
from sellable.ledger.database import Base, make_engine
from sellable.ledger.service import LedgerRepository
from sellable.main import app, get_ledger
from sellable.middleware import RequestBodyCaptureMiddleware
from sellable.registry import MerchantRegistry

import sellable.merchant_auth as merchant_auth

DEMO_H = {"X-Agent-Key": "sellable_demo_key_001"}


@pytest.fixture
def stream_ledger():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    ledger = LedgerRepository(engine)
    for i in range(5):
        ledger.append(
            LedgerEvent(
                trace_id=f"trc_stream_{i}",
                merchant_id="mrc_demo_store",
                actor=LedgerActor.COMMERCE_CORE,
                action="policy.checked",
                inputs={"n": i},
            )
        )
    return ledger


@pytest.fixture
def isolated_app(stream_ledger, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    app.dependency_overrides[get_ledger] = lambda: stream_ledger
    monkeypatch.setattr(
        main_module,
        "registry",
        MerchantRegistry(ledger=stream_ledger, engine=stream_ledger._engine),
    )
    try:
        yield app
    finally:
        app.dependency_overrides.clear()


def _scope(path: str) -> dict:
    return {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "query_string": b"",
        "headers": [(b"x-agent-key", b"sellable_demo_key_001")],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
        "app": app,
        "state": {},
    }


def test_middleware_propagates_disconnect() -> None:
    """The HMAC body-capture layer must not swallow http.disconnect."""
    seen: dict[str, object] = {}

    async def scenario() -> None:
        messages = [
            {"type": "http.request", "body": b'{"part":1}', "more_body": True},
            {"type": "http.request", "body": b'{"part":2}', "more_body": False},
            {"type": "http.disconnect"},
        ]

        async def receive() -> dict:
            return messages.pop(0)

        async def downstream(scope: dict, receive: object, send: object) -> None:
            assert scope["state"]["sellable_body_sha256"] != ""
            chunks = []
            while True:
                message = await receive()  # type: ignore[operator]
                if message["type"] == "http.disconnect":
                    break
                chunks.append(message.get("body", b""))
                if not message.get("more_body"):
                    break
            seen["body"] = b"".join(chunks)
            # A second, later receive (e.g. is_disconnected) must also
            # observe the disconnect rather than a fake empty request.
            later = await receive()  # type: ignore[operator]
            seen["later"] = later["type"]

        await RequestBodyCaptureMiddleware(downstream)(
            {"type": "http", "state": {}}, receive, lambda message: asyncio.sleep(0)
        )

    asyncio.run(scenario())
    assert seen["body"] == b'{"part":1}{"part":2}'
    assert seen["later"] == "http.disconnect"


def test_stream_terminates_on_disconnect_and_drains_registry(isolated_app) -> None:
    """Closing the connection ends the server stream and clears the registry."""
    sent: list[dict] = []
    receive_queue: asyncio.Queue[dict] = asyncio.Queue()

    async def scenario() -> None:
        await receive_queue.put({"type": "http.request", "body": b"", "more_body": False})

        async def receive() -> dict:
            return await receive_queue.get()

        async def send(message: dict) -> None:
            sent.append(message)

        task = asyncio.ensure_future(
            isolated_app(_scope("/activity/stream"), receive, send)
        )
        # Wait for the handshake frame, proving the stream is live.
        for _ in range(100):
            await asyncio.sleep(0.1)
            if any(
                message.get("type") == "http.response.body" for message in sent
            ):
                break
        assert any(
            message.get("type") == "http.response.body" for message in sent
        ), "stream never started"
        assert len(main_module._active_sse_streams) == 1

        # Browser navigates away: the disconnect must terminate the stream.
        await receive_queue.put({"type": "http.disconnect"})
        await asyncio.wait_for(task, timeout=10)

    asyncio.run(scenario())
    assert main_module._active_sse_streams == {}, (
        f"stale streams remain: {main_module._active_sse_streams}"
    )


def test_open_stream_does_not_block_other_endpoints(isolated_app) -> None:
    """While one SSE stream is connected, health/events/status stay responsive."""

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=isolated_app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            receive_queue: asyncio.Queue[dict] = asyncio.Queue()
            await receive_queue.put(
                {"type": "http.request", "body": b"", "more_body": False}
            )

            async def receive() -> dict:
                return await receive_queue.get()

            sent: list[dict] = []

            async def send(message: dict) -> None:
                sent.append(message)

            stream_task = asyncio.ensure_future(
                isolated_app(_scope("/activity/stream"), receive, send)
            )
            try:
                for _ in range(100):
                    await asyncio.sleep(0.1)
                    if any(
                        message.get("type") == "http.response.body" for message in sent
                    ):
                        break
                assert any(
                    message.get("type") == "http.response.body" for message in sent
                ), "stream never started"
                assert len(main_module._active_sse_streams) == 1

                for path in ("/health", "/console/events?limit=5", "/agents/status"):
                    start = time.perf_counter()
                    response = await asyncio.wait_for(
                        client.get(path, headers=DEMO_H), timeout=15
                    )
                    elapsed = time.perf_counter() - start
                    assert response.status_code == 200, f"{path} -> {response.status_code}"
                    assert elapsed < 15, f"{path} took {elapsed:.1f}s with SSE open"
            finally:
                await receive_queue.put({"type": "http.disconnect"})
                await asyncio.wait_for(stream_task, timeout=10)

    asyncio.run(scenario())
    assert main_module._active_sse_streams == {}


def test_engine_pool_is_shared_not_per_request() -> None:
    first = make_engine()
    second = make_engine()
    assert first is second

    first_mem = make_engine(Settings(database_url="sqlite+pysqlite:///:memory:"))
    second_mem = make_engine(Settings(database_url="sqlite+pysqlite:///:memory:"))
    assert first_mem is not second_mem
