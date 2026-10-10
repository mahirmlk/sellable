"""Phase 0 application entrypoint."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, ValidationError
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse, StreamingResponse

from sellable.agents.buyer import BuyerAgent, BuyerResult
from sellable.agents.customer_service import (
    CSDecision,
    CSRequest,
    CustomerServiceAgent,
)
from sellable.agents.seller import SellerAgent, SellerDecision, SellerRequest
from agents.runtime.versions import CUSTOMER_SERVICE_AGENT_ID, SELLER_AGENT_ID
from agents.seller.intent import TurnKind, classify_buyer_message
from sellable.auth import AgentApiKey, get_agent_api_key, get_agent_api_key_signed
from sellable.buyer_missions import BuyerMissionService, UnknownBuyerMissionError
from sellable.config import settings
from sellable.contracts import (
    AgentProfile,
    BuyerMission,
    CatalogGetRequest,
    CatalogSearchRequest,
    CheckoutSession,
    CheckoutSessionListItem,
    CheckoutSessionPatch,
    CheckoutSessionStatus,
    CheckoutSessionUpsert,
    ConsentRequest,
    ConsoleApprovalRequest,
    ConsoleBuyerMission,
    ConsoleGrowthMetrics,
    ConsolePolicySettings,
    ConsolePolicyUpdate,
    ConsoleTransactionDetail,
    ConsoleTransactionItem,
    ConsentStatus,
    IntentMandate,
    LedgerActor,
    MerchantPolicy,
    OrderCreateRequest,
    OrderStatus,
    OrderStatusRequest,
    PaymentAttempt,
    PaymentStartRequest,
    PolicyVerdict,
    Product,
    RefundCreateRequest,
)
from sellable.core import CommerceCore, IdempotencyReuseError
from sellable.delegations import OperationScope
from sellable.protocols import a2a, dispatch, mcp, ucp
from sellable.protocols.capabilities import build_merchant_profile
from sellable.protocols.dispatch import ProtocolContext, ProtocolError
from sellable.protocols.identity import IdentityLinkService
from sellable.protocols.sessions import ProtocolSessionService
from sellable.gateway import (
    AgentGateway,
    DelegationDeniedError,
    DelegationHoldError,
    enforce_delegation,
)
from sellable.ledger.database import initialise_database
from sellable.ledger.service import LedgerRepository
from sellable.merchant_auth import (
    AuthenticatedUser,
    MerchantSession,
    get_authenticated_user,
    get_merchant_session,
)
from sellable.middleware import RequestBodyCaptureMiddleware
from sellable.payments.razorpay import (
    InvalidWebhookSignatureError,
    RazorpayAdapter,
    RazorpayConfigurationError,
    RazorpayRequestError,
)
from sellable.payments.service import (
    PaymentService,
    UnexpectedOrderStateError,
    UnknownProviderOrderError,
    UnsupportedWebhookEventError,
)
from sellable.refunds import RefundService
from sellable.registry import (
    DEMO_MERCHANT_ID,
    MerchantRegistry,
    save_policy_for,
)
from sellable.repositories import (
    CatalogRepository,
    CheckoutSessionRepository,
    IdentityLinkRepository,
    MerchantRepository,
    ObservabilityRepository,
    OrderRepository,
    ProtocolSessionRepository,
)
from sellable.status import build_status

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("sellable")

limiter = Limiter(key_func=get_remote_address)


def _assert_single_worker() -> None:
    """Refuse multi-worker startup until money invariants are DB-backed.

    Consent single-use, order idempotency, and payment-attempt locks are
    process-memory (threading locks) with only partial DB backstops, so a
    second worker/replica silently voids them. The supported deploy is a
    single worker (see Dockerfile CMD); any explicit multi-worker launcher
    config (``WEB_CONCURRENCY``/``UVICORN_WORKERS`` > 1) fails closed here
    instead of risking a double-spend. Remove this guard only when consent
    consumption and attempt creation are atomic DB transitions.
    """
    raw = os.getenv("WEB_CONCURRENCY") or os.getenv("UVICORN_WORKERS") or "1"
    try:
        workers = int(str(raw).strip())
    except ValueError:
        raise RuntimeError(
            f"WEB_CONCURRENCY/UVICORN_WORKERS={raw!r} is not an integer; "
            "single-worker deploy required until money invariants are DB-backed"
        ) from None
    if workers != 1:
        raise RuntimeError(
            f"Multi-worker startup refused (workers={workers}): consent "
            "single-use and payment-attempt invariants are process-memory "
            "only. Deploy a single worker until they are DB-backed."
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Starting SELLABLE Commerce Core")
    _assert_single_worker()
    initialise_database()
    logger.info("Database initialized")
    # Non-blocking JWKS warm: daemon thread only, startup never waits on it.
    try:
        from sellable.supabase_jwt import warm_jwks_cache

        warm_jwks_cache()
    except Exception as exc:  # noqa: BLE001 — warm must never break startup
        logger.debug("JWKS warm skipped: %s", exc)
    yield
    logger.info("Shutting down SELLABLE Commerce Core")


app = FastAPI(
    title="SELLABLE Commerce Core",
    version="0.1.0",
    summary="Deterministic foundation for safe agentic commerce.",
    description=(
        "SELLABLE makes a merchant discoverable, negotiable, and safely transactable by AI buyers.\n\n"
        "**Core principle:** Agents propose; deterministic policy, consent, and verified payment state decide."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "PUT", "HEAD", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Agent-Key", "Accept", "X-Agent-Id", "X-Timestamp", "X-Nonce", "X-Signature", "X-Trace-Id", "X-Delegation-Id", "X-Session-Id", "X-Protocol", "X-Customer-Id"],
    max_age=600,
)

app.add_middleware(RequestBodyCaptureMiddleware)

from sellable.tracing import trace_middleware

app.middleware("http")(trace_middleware)


async def version_prefix_middleware(request, call_next):
    """API versioning (§42, §17.1): `/v1/*` aliases the unversioned routes
    by stripping the prefix before routing. One implementation serves both
    shapes, so versioning can never drift between them."""
    path = request.scope.get("path", "")
    if path == "/v1" or path.startswith("/v1/"):
        stripped = path[3:] or "/"
        request.scope["path"] = stripped
        request.scope["raw_path"] = stripped.encode("latin-1")
    return await call_next(request)


app.middleware("http")(version_prefix_middleware)

app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded,
    lambda _, exc: JSONResponse(status_code=429, content={"detail": f"Rate limit exceeded: {exc.detail}"}),
)


# ---------------------------------------------------------------------------
# Per-merchant helpers
# ---------------------------------------------------------------------------


def _make_llm() -> tuple[object | None, str | None]:
    """Return a real LLM adapter when a non-mock provider is configured.

    Never silently substitutes a deterministic adapter: initialization
    failures are surfaced to /agents/status as a real ERROR with the reason.
    """
    from agents.llm import get_llm

    if settings.llm_provider in ("mock", "deterministic", ""):
        return None, None
    if not settings.llm_is_configured:
        return None, None
    try:
        return get_llm(), None
    except Exception as exc:
        logger.error("LLM adapter initialization failed: %s", exc)
        return None, str(exc)


def _agent_recorder(core: CommerceCore, agent_id: str):
    """Run recorder writing §29.1 telemetry for the merchant's own store."""
    from agents.runtime.recorder import AgentRunRecorder

    return AgentRunRecorder(
        ObservabilityRepository(), merchant_id=core.merchant_scope, agent_id=agent_id
    )


_seller_llm, _llm_init_error = _make_llm()

# Create tables and the real demo-merchant records before wiring components.
initialise_database()
registry = MerchantRegistry()
registry.ensure_demo_merchant()
commerce_core = registry.get(DEMO_MERCHANT_ID)
seller_agent = SellerAgent(
    commerce_core,
    llm=_seller_llm,
    recorder=_agent_recorder(commerce_core, SELLER_AGENT_ID),
)
agent_gateway = AgentGateway(commerce_core, seller_agent)
customer_service_agent = CustomerServiceAgent(
    commerce_core,
    llm=_seller_llm,
    recorder=_agent_recorder(commerce_core, CUSTOMER_SERVICE_AGENT_ID),
)
buyer_agent = BuyerAgent(agent_gateway, llm=_make_llm()[0])
payment_service = PaymentService(commerce_core, RazorpayAdapter(settings), core_resolver=registry.get)
refund_service = RefundService(commerce_core, RazorpayAdapter(settings))
buyer_mission_service = BuyerMissionService()
session_service = ProtocolSessionService(ProtocolSessionRepository())
identity_service = IdentityLinkService(IdentityLinkRepository())


def merchant_buyer_agent(core: CommerceCore) -> BuyerAgent:
    """A buyer agent bound to the given merchant's own core.

    Used for the read-only post-settlement verification: its ledger events
    are written under the merchant's scope, never the demo store's.
    """
    return BuyerAgent(AgentGateway(core, SellerAgent(core, llm=_seller_llm)))


def merchant_core(session: MerchantSession) -> CommerceCore:
    """Return the caller's own merchant core (scoped catalog, policy, orders)."""
    return registry.get(session.merchant_id)


def require_owner(session: MerchantSession) -> None:
    """Owner-only actions: policy changes and money-out (refunds).

    Approvals, rejections, and fulfillment stay member-level — they are the
    day-to-day operational queue. Every membership row defaults to owner;
    operators are read-only for config and refunds.
    """
    if session.role != "owner":
        raise HTTPException(
            status_code=403, detail="This action requires the merchant owner role"
        )


_TRACE_ID_PATTERN = re.compile(r"^trc_[0-9a-f]{32}$")


def resolve_trace_id(
    x_trace_id: str | None, *, body_trace_id: str | None = None
) -> str:
    """One stable trace id per client transaction flow.

    Precedence: ``X-Trace-Id`` header > body ``trace_id`` > fresh server id.
    A malformed header is rejected (422, same pattern as
    ``OrderCreateRequest.trace_id``) so flows never silently fork into
    uncorrelatable fragments. Quote → order → consent → payment issued with
    the same header then share one replayable trace.
    """
    from uuid import uuid4

    candidate = x_trace_id or body_trace_id
    if candidate is None:
        return f"trc_{uuid4().hex}"
    if not _TRACE_ID_PATTERN.match(candidate):
        raise HTTPException(
            status_code=422, detail="X-Trace-Id must match ^trc_[0-9a-f]{32}$"
        )
    return candidate


def _gate_delegation(
    commerce: CommerceCore,
    *,
    delegation_id: str | None,
    scope: OperationScope,
    amount_paise: int | None,
    trace_id: str,
    route: str,
    hold_status: int = 409,
) -> None:
    """Resolve an optional delegation header: DENY → 403, hold → ``hold_status``.

    No header → legacy behavior unchanged. Amount binding stays at the
    commerce layer, which re-resolves with exact totals.
    """
    try:
        enforce_delegation(
            commerce,
            delegation_id=delegation_id,
            scope=scope,
            amount_paise=amount_paise,
            trace_id=trace_id,
            route=route,
        )
    except DelegationDeniedError as error:
        raise HTTPException(
            status_code=403,
            detail={"reason_code": error.reason_code, "route": route},
        ) from error
    except DelegationHoldError as error:
        raise HTTPException(
            status_code=hold_status,
            detail={
                "outcome": error.outcome,
                "reason_code": error.reason_code,
                "route": route,
            },
        ) from error


def get_seller_agent() -> SellerAgent:
    return seller_agent


def get_customer_service_agent() -> CustomerServiceAgent:
    return customer_service_agent


def get_payment_service() -> PaymentService:
    return payment_service


def get_agent_gateway() -> AgentGateway:
    return agent_gateway


def get_buyer_agent() -> BuyerAgent:
    return buyer_agent


def get_refund_service() -> RefundService:
    return refund_service


def get_commerce() -> CommerceCore:
    return commerce_core


def get_ledger() -> LedgerRepository:
    return commerce_core.ledger


@app.get("/health", tags=["operations"])
@limiter.exempt
def health() -> dict[str, str | bool | list[str]]:
    if settings.is_dev_environment:
        return {
            "status": "ok",
            "environment": settings.environment,
            "database": "connected",
            "razorpay_configured": settings.razorpay_is_configured,
            "cors_origins": list(settings.cors_origins),
        }
    # Production: minimal liveness shape. The full CORS origin list plus
    # environment/config flags aid reconnaissance and CORS-misconfig review
    # from outside; operators already have them in deploy config.
    return {"status": "ok", "database": "connected"}


@app.post(
    "/agent/seller/respond",
    response_model=SellerDecision,
    tags=["seller-agent"],
    summary="Create a policy-evaluated candidate cart from a buyer request.",
)
@limiter.limit("30/minute")
def seller_respond(
    request: Request,
    body: SellerRequest,
    agent: SellerAgent = Depends(get_seller_agent),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
) -> SellerDecision:
    """Never creates an order, issues consent, or executes a payment."""
    return agent.respond(body, trace_id=resolve_trace_id(x_trace_id))


@app.post(
    "/agent/service/respond",
    response_model=CSDecision,
    tags=["customer-service-agent"],
    summary="Authenticated post-purchase support: order help, shipping, returns, refunds.",
)
@limiter.limit("30/minute")
def service_respond(
    request: Request,
    body: CSRequest,
    agent: CustomerServiceAgent = Depends(get_customer_service_agent),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
) -> CSDecision:
    """Never executes refunds, mutates account security, or overrides policy."""
    return agent.respond(body, trace_id=resolve_trace_id(x_trace_id))


# ---------------------------------------------------------------------------
# Protocol interoperability (target §15-§17): one commerce core, many
# protocol surfaces. Canonical /commerce/* commands plus MCP/A2A/UCP
# adapters, capability negotiation, and identity linking.
# ---------------------------------------------------------------------------

SUPPORTED_PROTOCOLS = ("rest", "mcp", "a2a", "ucp")


def _protocol_ctx(
    *,
    protocol: str | None,
    trace_id: str,
    agent_id: str | None = None,
    session_id: str | None = None,
    delegation_id: str | None = None,
    customer_id: str | None = None,
) -> ProtocolContext:
    name = (protocol or "rest").lower()
    if name not in SUPPORTED_PROTOCOLS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown protocol '{protocol}'. Choose one of {list(SUPPORTED_PROTOCOLS)}.",
        )
    return ProtocolContext(
        protocol=name,
        trace_id=trace_id,
        agent_id=agent_id,
        session_id=session_id,
        delegation_id=delegation_id,
        customer_id=customer_id,
    )


def _protocol_result(result: object) -> object:
    """Serialize dispatcher results (pydantic → JSON, lists, plain dicts)."""
    if isinstance(result, list):
        return [_protocol_result(item) for item in result]
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    return result


def _protocol_call(fn, *args, **kwargs):
    try:
        return _protocol_result(fn(*args, **kwargs))
    except ProtocolError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"reason_code": error.reason_code, "detail": str(error)},
        ) from error
    except Exception as error:  # noqa: BLE001 — adapters degrade, never 500 commerce
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/.well-known/ucp", tags=["protocol-ucp"])
@limiter.exempt
def ucp_well_known(request: Request) -> dict[str, object]:
    return ucp.discovery_document(
        commerce_core, base_url=str(request.base_url).rstrip("/")
    )


@app.get("/agent/profile", tags=["protocol-discovery"])
@limiter.exempt
def agent_profile() -> dict[str, object]:
    """Merchant agent profile: the two platform agents and versions."""
    from agents.runtime.versions import VersionRegistry, seed_registry

    versions = seed_registry(VersionRegistry(), commerce_core.policy)
    return {
        "merchant_id": commerce_core.merchant_scope,
        "agents": [version.as_dict() for version in versions.all()],
    }


@app.get("/agent/capabilities", tags=["protocol-discovery"])
@limiter.exempt
def agent_capabilities() -> dict[str, object]:
    """Merchant capability profile for negotiation (§15.1)."""
    return build_merchant_profile(commerce_core.merchant_scope).model_dump(mode="json")


@app.post("/commerce/sessions/negotiate", tags=["protocol-sessions"])
@limiter.limit("30/minute")
def session_negotiate(
    request: Request,
    body: AgentProfile,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> dict:
    try:
        session = session_service.negotiate(
            commerce.merchant_scope,
            body,
            build_merchant_profile(commerce.merchant_scope),
        )
    except Exception as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return session.model_dump(mode="json")


@app.get("/commerce/sessions/{session_id}", tags=["protocol-sessions"])
@limiter.limit("60/minute")
def session_get(
    session_id: str,
    request: Request,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> dict:
    try:
        session = session_service.get(session_id, commerce.merchant_scope)
    except Exception as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return session.model_dump(mode="json")


@app.post("/ucp/negotiate", tags=["protocol-ucp"])
@limiter.limit("30/minute")
def ucp_negotiate(
    request: Request,
    body: AgentProfile,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> dict:
    try:
        session = ucp.negotiate(commerce, session_service, body)
    except Exception as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return session.model_dump(mode="json")


@app.post("/commerce/identity/link", tags=["protocol-identity"])
@limiter.limit("30/minute")
def identity_link_create(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
) -> dict:
    customer_id = body.get("customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required")
    link, code = identity_service.create_link(
        commerce.merchant_scope,
        str(customer_id),
        agent_id=body.get("agent_id"),
        protocol="rest",
        scopes=list(body.get("scopes") or []),
    )
    dumped = link.model_dump(mode="json")
    dumped.pop("link_code_hash", None)
    dumped["link_code"] = code  # shown exactly once
    return dumped


@app.post("/commerce/identity/link/approve", tags=["protocol-identity"])
@limiter.limit("30/minute")
def identity_link_approve(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> dict:
    if not body.get("link_id"):
        raise HTTPException(status_code=400, detail="link_id is required")
    try:
        link = identity_service.approve_link(
            str(body["link_id"]),
            commerce.merchant_scope,
            link_code=body.get("link_code"),
            merchant_approved=bool(body.get("merchant_approved")),
        )
    except Exception as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    dumped = link.model_dump(mode="json")
    dumped.pop("link_code_hash", None)
    return dumped


@app.get("/commerce/identity/me", tags=["protocol-identity"])
@limiter.limit("60/minute")
def identity_me(
    request: Request,
    link_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> dict:
    try:
        link = identity_service.get_link(link_id, commerce.merchant_scope)
    except Exception as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    if link.status.value != "LINKED":
        raise HTTPException(status_code=404, detail="No linked identity")
    return {
        "customer_id": link.customer_id,
        "agent_id": link.agent_id,
        "scopes": list(link.scopes),
        "expires_at": link.expires_at.isoformat(),
    }


def _commerce_ctx(
    *,
    api_key: AgentApiKey,
    trace_id: str,
    protocol: str | None,
    session_id: str | None,
    delegation_id: str | None,
    customer_id: str | None,
) -> ProtocolContext:
    return _protocol_ctx(
        protocol=protocol,
        trace_id=trace_id,
        agent_id=getattr(api_key, "buyer_agent_id", None),
        session_id=session_id,
        delegation_id=delegation_id,
        customer_id=customer_id,
    )


def _require(body: dict, *fields: str) -> None:
    missing = [name for name in fields if body.get(name) is None]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Missing required fields: {missing}"
        )


@app.post("/commerce/search", tags=["protocol-commerce"])
@limiter.limit("60/minute")
def commerce_search(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> list:
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.search_catalog, commerce, session_service, ctx,
        query=str(body.get("query", "")),
        categories=body.get("categories"),
    )


@app.post("/commerce/catalog/lookup", tags=["protocol-commerce"])
@limiter.limit("60/minute")
def commerce_lookup(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "sku")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.lookup_product, commerce, session_service, ctx, sku=str(body["sku"])
    )


@app.post("/commerce/recommendations", tags=["protocol-commerce"])
@limiter.limit("60/minute")
def commerce_recommendations(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> list:
    _require(body, "sku")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.get_recommendations, commerce, session_service, ctx,
        sku=str(body["sku"]), limit=int(body.get("limit") or 3),
    )


@app.post("/commerce/cart", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_cart_create(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
    x_customer_id: str | None = Header(default=None),
) -> dict:
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=x_customer_id or body.get("customer_id"),
    )
    return _protocol_call(
        dispatch.create_cart, commerce, session_service, ctx,
        customer_id=body.get("customer_id"),
    )


@app.post("/commerce/cart/items", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_cart_items(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "cart_id", "op", "sku", "quantity", "expected_version")
    if body["op"] not in ("add", "set", "remove"):
        raise HTTPException(status_code=400, detail="op must be add, set, or remove")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.mutate_cart_item, commerce, session_service, ctx,
        cart_id=str(body["cart_id"]), op=str(body["op"]), sku=str(body["sku"]),
        quantity=int(body["quantity"]), expected_version=int(body["expected_version"]),
    )


@app.post("/commerce/quotes", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_quote_create(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "cart_id")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.create_quote, commerce, session_service, ctx,
        cart_id=str(body["cart_id"]),
    )


@app.post("/commerce/quotes/negotiate", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_quote_negotiate(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "quote_id", "proposed_total_paise")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    result = _protocol_call(
        dispatch.negotiate_quote, commerce, session_service, ctx,
        quote_id=str(body["quote_id"]),
        proposed_total_paise=int(body["proposed_total_paise"]),
    )
    result["quote"] = _protocol_result(result["quote"])
    return result


@app.post("/commerce/promotions/evaluate", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_promotions_evaluate(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    if not body.get("cart_id") and not body.get("checkout_id"):
        raise HTTPException(status_code=400, detail="cart_id or checkout_id is required")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.evaluate_promotions, commerce, session_service, ctx,
        cart_id=body.get("cart_id"), checkout_id=body.get("checkout_id"),
        coupon_code=body.get("coupon_code"), channel=str(body.get("channel") or "agent"),
    )


@app.post("/commerce/checkout", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_checkout_create(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "cart_id")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id or body.get("delegation_id"),
        customer_id=None,
    )
    return _protocol_call(
        dispatch.create_checkout, commerce, session_service, ctx,
        cart_id=str(body["cart_id"]),
        expected_version=body.get("expected_version"),
        delegation_id=body.get("delegation_id"),
        quote_id=body.get("quote_id"),
    )


@app.post("/commerce/checkout/authorize", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_checkout_authorize(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "checkout_id")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.authorize_checkout_pipeline, commerce, session_service, ctx,
        checkout_id=str(body["checkout_id"]),
        coupon_code=body.get("coupon_code"), channel=str(body.get("channel") or "agent"),
        tax_total_paise=int(body.get("tax_total_paise") or 0),
        shipping_total_paise=int(body.get("shipping_total_paise") or 0),
        merchant_state=body.get("merchant_state"),
        customer_state=body.get("customer_state"),
        shipping_method=body.get("shipping_method"),
        pincode=str(body.get("pincode") or ""),
    )


@app.post("/commerce/orders", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_order_create(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "checkout_id", "intent", "idempotency_key")
    try:
        intent = IntentMandate.model_validate(body["intent"])
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Invalid intent: {error}") from error
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id or body.get("delegation_id"),
        customer_id=None,
    )
    return _protocol_call(
        dispatch.create_order, commerce, session_service, ctx,
        checkout_id=str(body["checkout_id"]), intent=intent,
        idempotency_key=str(body["idempotency_key"]),
        delegation_id=body.get("delegation_id"),
    )


@app.get("/commerce/orders/{order_id}", tags=["protocol-commerce"])
@limiter.limit("60/minute")
def commerce_order_get(
    order_id: str,
    request: Request,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.get_order, commerce, session_service, ctx, order_id=order_id
    )


@app.post("/commerce/shipping/quote", tags=["protocol-commerce"])
@limiter.limit("60/minute")
def commerce_shipping_quote(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> list:
    _require(body, "pincode")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.shipping_quote, commerce, session_service, ctx,
        pincode=str(body["pincode"]),
        free_shipping=bool(body.get("free_shipping")),
    )


@app.post("/commerce/returns", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_return_create(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
    x_customer_id: str | None = Header(default=None),
) -> dict:
    _require(body, "order_id", "items", "reason")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=x_customer_id,
    )
    return _protocol_call(
        dispatch.create_return, commerce, session_service, ctx,
        order_id=str(body["order_id"]), items=list(body["items"]),
        reason=str(body["reason"]), customer_id=x_customer_id,
    )


@app.post("/commerce/refunds/requests", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_refund_request(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    _require(body, "order_id", "amount_paise", "reason")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=None,
    )
    return _protocol_call(
        dispatch.request_refund, commerce, session_service, ctx,
        order_id=str(body["order_id"]), amount_paise=int(body["amount_paise"]),
        reason=str(body["reason"]), return_id=body.get("return_id"),
    )


@app.post("/commerce/support/cases", tags=["protocol-commerce"])
@limiter.limit("30/minute")
def commerce_support_create(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_protocol: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
    x_customer_id: str | None = Header(default=None),
) -> dict:
    _require(body, "summary")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol=x_protocol, session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=x_customer_id,
    )
    return _protocol_call(
        dispatch.create_support_case, commerce, session_service, ctx,
        summary=str(body["summary"]), order_id=body.get("order_id"),
        category=str(body.get("category") or "other"),
    )


@app.get("/mcp/tools", tags=["protocol-mcp"])
@limiter.limit("60/minute")
def mcp_tools(
    request: Request,
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> list:
    return mcp.list_tools()


@app.post("/mcp/call", tags=["protocol-mcp"])
@limiter.limit("30/minute")
def mcp_call(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
    x_customer_id: str | None = Header(default=None),
) -> dict:
    _require(body, "tool")
    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol="mcp", session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=x_customer_id,
    )
    try:
        result = mcp.call_tool(
            commerce, session_service, ctx,
            tool=str(body["tool"]), arguments=dict(body.get("arguments") or {}),
        )
    except ProtocolError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"reason_code": error.reason_code, "detail": str(error)},
        ) from error
    except Exception as error:  # noqa: BLE001 — adapters degrade, never 500 commerce
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"tool": body["tool"], "result": _protocol_result(result)}


@app.get("/a2a/card", tags=["protocol-a2a"])
@limiter.exempt
def a2a_card() -> dict[str, object]:
    from sellable.repositories import MerchantRepository

    merchant_id = commerce_core.merchant_scope
    name = MerchantRepository().name_of(merchant_id) or merchant_id
    return a2a.agent_card(merchant_id, name)


@app.post("/a2a/tasks", tags=["protocol-a2a"])
@limiter.limit("30/minute")
def a2a_task(
    request: Request,
    body: dict,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
    x_customer_id: str | None = Header(default=None),
) -> dict:
    _require(body, "actor", "input")
    from sellable.agents.seller import SellerAgent

    from agents.customer_service.agent import CustomerServiceAgent

    ctx = _commerce_ctx(
        api_key=_api_key, trace_id=resolve_trace_id(x_trace_id),
        protocol="a2a", session_id=x_session_id,
        delegation_id=x_delegation_id, customer_id=x_customer_id,
    )
    try:
        result = a2a.handle_task(
            SellerAgent(commerce),
            CustomerServiceAgent(commerce),
            ctx,
            actor=str(body["actor"]),
            input=dict(body["input"]),
        )
    except ProtocolError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"reason_code": error.reason_code, "detail": str(error)},
        ) from error
    return result


# ---------------------------------------------------------------------------
# Event bus, notifications, analytics, operations (target §27, §29, §34-§36)
# ---------------------------------------------------------------------------

def _build_bus():
    """Assemble the standard bus from current engines (per-call so tests
    with isolated databases get isolated buses)."""
    from sellable.event_bus import build_bus
    from sellable.notifications import WebhookDispatcher
    from sellable.repositories import (
        AnalyticsRepository,
        NotificationRepository,
        OutboxRepository,
        WebhookRepository,
    )

    outbox = OutboxRepository()
    analytics = AnalyticsRepository()
    notifications_repo = NotificationRepository()
    webhooks = WebhookRepository()
    dispatcher = WebhookDispatcher(webhooks)
    return build_bus(
        outbox_repo=outbox,
        analytics_repo=analytics,
        notification_repo=notifications_repo,
        webhook_dispatcher=dispatcher,
        core_resolver=lambda merchant_id: registry.get(merchant_id),
    )


def _drain_bus_best_effort(*, merchant_id: str | None = None) -> None:
    try:
        from sellable.event_bus import drain_once

        drain_once(_build_bus(), merchant_id=merchant_id)
    except Exception as exc:  # noqa: BLE001 — drains never break webhooks
        logger.warning("Event bus drain failed: %s", exc)


@app.post(
    "/webhooks/shipping/{carrier}",
    tags=["webhooks"],
    summary="Ingest a carrier tracking update (shared-secret authenticated).",
)
@limiter.limit("120/minute")
def shipping_webhook(
    carrier: str,
    request: Request,
    body: dict,
    x_carrier_secret: str | None = Header(default=None),
) -> dict:
    """Carrier status ingestion (§23.1, §36.1): signature-light shared
    secret per deploy; per-merchant carrier secrets arrive in Phase 8."""
    import hmac as _hmac

    secret = settings.shipping_webhook_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Shipping webhooks are not configured")
    if not x_carrier_secret or not _hmac.compare_digest(x_carrier_secret, secret):
        raise HTTPException(status_code=401, detail="Invalid carrier secret")
    tracking_reference = body.get("tracking_reference")
    status = body.get("status")
    if not tracking_reference or not status:
        raise HTTPException(
            status_code=400, detail="tracking_reference and status are required"
        )
    from sellable.contracts import FulfillmentStatus
    from sellable.repositories import FulfillmentRepository

    try:
        target = FulfillmentStatus(str(status).upper())
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Unknown fulfillment status: {status}"
        ) from None
    fulfillment = FulfillmentRepository().for_tracking(str(tracking_reference))
    if fulfillment is None:
        raise HTTPException(status_code=404, detail="Unknown tracking reference")
    core = registry.get(fulfillment.merchant_id)
    try:
        updated = core.track_fulfillment(
            fulfillment.fulfillment_id,
            target,
            trace_id=resolve_trace_id(request.headers.get("X-Trace-Id")),
            location=body.get("location"),
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    _drain_bus_best_effort()
    return {
        "fulfillment_id": updated.fulfillment_id,
        "status": updated.status.value,
        "carrier": carrier,
    }


@app.get("/console/notifications", tags=["console"])
@limiter.limit("60/minute")
def console_notifications(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    unread_only: bool = False,
    limit: int = 50,
) -> list:
    from sellable.repositories import NotificationRepository

    return NotificationRepository().list_for_merchant(
        session.merchant_id, limit=limit, unread_only=unread_only
    )


@app.post("/console/notifications/{notification_id}/read", tags=["console"])
@limiter.limit("60/minute")
def console_notification_read(
    notification_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from sellable.repositories import NotificationRepository

    if not NotificationRepository().mark_read(notification_id, session.merchant_id):
        raise HTTPException(status_code=404, detail="Unknown notification")
    return {"notification_id": notification_id, "status": "READ"}


@app.get("/console/analytics/overview", tags=["console"])
@limiter.limit("60/minute")
def console_analytics_overview(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    days: int = 30,
) -> dict:
    from datetime import timedelta

    from sellable.contracts import utc_now
    from sellable.repositories import AnalyticsRepository, PromotionRepository

    since = utc_now() - timedelta(days=max(days, 1))
    overview = AnalyticsRepository().overview(session.merchant_id, since=since)
    usage = PromotionRepository().usage(session.merchant_id)
    overview["promotion_redemptions"] = sum(u["count"] for u in usage.values())
    overview["promotion_discount_paise"] = sum(u["discount_paise"] for u in usage.values())
    return overview


@app.get("/console/analytics/timeseries", tags=["console"])
@limiter.limit("60/minute")
def console_analytics_timeseries(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    days: int = 30,
) -> list:
    from sellable.repositories import AnalyticsRepository

    return AnalyticsRepository().timeseries(session.merchant_id, days=days)


@app.get("/console/onboarding/readiness", tags=["console"])
@limiter.limit("30/minute")
def console_onboarding_readiness(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> dict:
    """Automated merchant readiness checks (§10.3) with per-check results
    recorded on the onboarding row."""
    from sellable.repositories import SandboxRepository

    core = merchant_core(session)
    results = core.refresh_onboarding_readiness(
        trace_id=resolve_trace_id(x_trace_id),
        payment_configured=bool(
            settings.razorpay_is_configured or settings.stripe_secret_key
        ),
        webhook_configured=bool(
            settings.razorpay_webhook_secret or settings.shipping_webhook_secret
        ),
        sandbox_repo=SandboxRepository(),
    )
    onboarding = core.onboarding_repo.get(session.merchant_id)
    return {
        "merchant_id": session.merchant_id,
        "stage": onboarding.stage.value if onboarding else "CREATED",
        "checks": results,
        "activation_ready": onboarding.is_activation_ready if onboarding else False,
    }


# ---------------------------------------------------------------------------
# Agent evaluation (target §30, §33): versioned suites, release runs, drift.
# Eval runs execute against an ISOLATED in-memory core — never merchant data.
# ---------------------------------------------------------------------------

def _fresh_eval_core():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from sellable.ledger.database import Base
    from sellable.ledger.service import LedgerRepository

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    return core, engine


@app.get("/console/evals/suites", tags=["console"])
@limiter.limit("60/minute")
def console_eval_suites(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> list:
    from evals.datasets.v1 import SUITES
    from sellable.repositories import EvaluationRepository

    repo = EvaluationRepository()
    suites = []
    for suite_id, spec in SUITES.items():
        latest = repo.latest_run_for_suite(suite_id)
        suites.append(
            {
                "suite_id": spec.suite_id,
                "name": spec.name,
                "version": spec.version,
                "description": spec.description,
                "cases": len(spec.cases),
                "latest_run": latest,
            }
        )
    return suites


@app.post("/console/evals/suites/{suite_id}/run", tags=["console"])
@limiter.limit("10/minute")
def console_eval_run(
    suite_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from evals.datasets.v1 import SUITES
    from evals.runner.harness import EvaluationHarness
    from sellable.repositories import EvaluationRepository

    if suite_id not in SUITES:
        raise HTTPException(status_code=404, detail="Unknown suite")
    harness = EvaluationHarness(EvaluationRepository())
    report = harness.run_suite(lambda: _fresh_eval_core()[0], suite_id)
    return {
        "run_id": report.run_id,
        "suite_id": report.suite_id,
        "passed": report.passed,
        "failed": report.failed,
        "duration_ms": report.duration_ms,
        "cost_usd": report.cost_usd,
    }


@app.get("/console/evals/runs/{run_id}", tags=["console"])
@limiter.limit("60/minute")
def console_eval_run_detail(
    run_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from sellable.repositories import EvaluationRepository

    repo = EvaluationRepository()
    results = repo.results_for_run(run_id)
    if not results:
        raise HTTPException(status_code=404, detail="Unknown eval run")
    return {"run_id": run_id, "results": results}


@app.get("/console/evals/drift", tags=["console"])
@limiter.limit("30/minute")
def console_eval_drift(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    days: int = 7,
    baseline_days: int = 7,
) -> dict:
    from datetime import timedelta

    from evals.drift import collect_production_stats, compare
    from sellable.contracts import utc_now
    from sellable.ledger.service import LedgerRepository
    from sellable.repositories import AnalyticsRepository, ObservabilityRepository

    moment = utc_now()
    current = collect_production_stats(
        ledger=LedgerRepository(),
        observability_repo=ObservabilityRepository(),
        analytics_repo=AnalyticsRepository(),
        merchant_id=session.merchant_id,
        days=max(days, 1),
        now=moment,
    )
    baseline = collect_production_stats(
        ledger=LedgerRepository(),
        observability_repo=ObservabilityRepository(),
        analytics_repo=AnalyticsRepository(),
        merchant_id=session.merchant_id,
        days=max(baseline_days, 1),
        now=moment - timedelta(days=max(days, 1)),
    )
    report = compare(baseline, current)
    return {
        "drifted": report.drifted,
        "baseline": baseline,
        "current": current,
        "metrics": [
            {
                "metric": m.metric,
                "baseline": m.baseline,
                "current": m.current,
                "delta_bps": m.delta_bps,
                "drifted": m.drifted,
            }
            for m in report.metrics
        ],
    }


@app.get("/console/ops/overview", tags=["console"])
@limiter.limit("60/minute")
def console_ops_overview(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from sellable.repositories import (
        FraudRepository,
        ObservabilityRepository,
        OutboxRepository,
        RiskRepository,
        WebhookRepository,
    )

    merchant_id = session.merchant_id
    outbox = OutboxRepository()
    runs = ObservabilityRepository().list_runs(merchant_id, limit=50)
    dispatches = WebhookRepository().recent_dispatches(merchant_id, limit=50)
    risk_recent = RiskRepository().recent(merchant_id, limit=50)
    return {
        "merchant_id": merchant_id,
        "outbox": {
            "pending": outbox.pending_count(merchant_id),
            "dead_lettered": outbox.dead_letter_count(merchant_id),
        },
        "risk": {
            "recent_blocks": sum(1 for r in risk_recent if r.level.value == "BLOCK"),
            "recent_decisions": len(risk_recent),
        },
        "fraud": {
            "recent": [
                {
                    "kind": f.kind.value,
                    "subject_id": f.subject_id,
                    "created_at": f.created_at.isoformat(),
                }
                for f in FraudRepository().list_for(merchant_id, limit=20)
            ]
        },
        "agent_runs": {
            "recent": len(runs),
            "failures": sum(1 for r in runs if r["status"] not in ("COMPLETED", "RUNNING")),
            "runs": runs[:20],
        },
        "webhooks": {
            "dispatches": len(dispatches),
            "failures": sum(1 for d in dispatches if d["status"] != "SENT"),
            "recent": dispatches[:20],
        },
    }


@app.post("/console/ops/bus/drain", tags=["console"])
@limiter.limit("10/minute")
def console_bus_drain(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from sellable.event_bus import drain_once

    return drain_once(_build_bus(), merchant_id=session.merchant_id)


@app.get("/console/ops/dead-letters", tags=["console"])
@limiter.limit("60/minute")
def console_dead_letters(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    limit: int = 50,
) -> list:
    from sellable.repositories import OutboxRepository

    return OutboxRepository().list_dead_letters(session.merchant_id, limit=limit)


@app.post("/console/ops/dead-letters/{event_id}/retry", tags=["console"])
@limiter.limit("30/minute")
def console_dead_letter_retry(
    event_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from sellable.repositories import OutboxRepository

    if not OutboxRepository().reset_delivery(event_id, session.merchant_id):
        raise HTTPException(status_code=404, detail="Unknown dead-lettered event")
    return {"event_id": event_id, "status": "REQUEUED"}


@app.get("/console/webhooks/subscriptions", tags=["console"])
@limiter.limit("60/minute")
def console_webhook_subscriptions(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> list:
    from sellable.repositories import WebhookRepository

    return WebhookRepository().list_subscriptions(session.merchant_id)


@app.post("/console/webhooks/subscriptions", tags=["console"])
@limiter.limit("30/minute")
def console_webhook_subscribe(
    request: Request,
    body: dict,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    import secrets as _secrets

    from sellable.notifications import SUBSCRIBABLE_EVENTS
    from sellable.repositories import WebhookRepository

    url = body.get("url")
    events = list(body.get("events") or [])
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    unknown = [e for e in events if e not in SUBSCRIBABLE_EVENTS]
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Unknown event types: {unknown}"
        )
    if not events:
        raise HTTPException(status_code=400, detail="At least one event is required")
    secret = _secrets.token_urlsafe(32)
    try:
        subscription = WebhookRepository().create_subscription(
            merchant_id=session.merchant_id,
            url=str(url),
            events=events,
            secret=secret,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {
        **subscription.model_dump(mode="json"),
        "secret": secret,
        "_note": "Persist the secret now; it is shown exactly once.",
    }


@app.delete("/console/webhooks/subscriptions/{subscription_id}", tags=["console"])
@limiter.limit("30/minute")
def console_webhook_unsubscribe(
    subscription_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from sellable.repositories import WebhookRepository

    if not WebhookRepository().delete_subscription(subscription_id, session.merchant_id):
        raise HTTPException(status_code=404, detail="Unknown subscription")
    return {"subscription_id": subscription_id, "status": "DELETED"}


@app.get("/console/webhooks/dispatches", tags=["console"])
@limiter.limit("60/minute")
def console_webhook_dispatches(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    limit: int = 50,
) -> list:
    from sellable.repositories import WebhookRepository

    return WebhookRepository().recent_dispatches(session.merchant_id, limit=limit)


@app.get("/console/transactions/{order_id}/replay", tags=["console"])
@app.get("/transactions/{order_id}/replay", tags=["console"])
@limiter.limit("60/minute")
def console_transaction_replay(
    order_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    """Reconstructed evidence chain for one transaction (§28.3): ordered
    sections from ledger rows. Reads evidence; never re-executes money."""
    from sellable.replay import build_replay

    core = merchant_core(session)
    try:
        order = core.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return build_replay(order.trace_id, session.merchant_id, ledger=core.ledger)


@app.get("/console/metrics/agents", tags=["console"])
@limiter.limit("60/minute")
def console_agent_metrics(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    days: int = 7,
) -> dict:
    from sellable.metrics import agent_metrics
    from sellable.repositories import ObservabilityRepository

    core = merchant_core(session)
    return agent_metrics(
        observability_repo=ObservabilityRepository(),
        ledger=core.ledger,
        merchant_id=session.merchant_id,
        days=days,
    )


@app.get("/console/metrics/commerce", tags=["console"])
@limiter.limit("60/minute")
def console_commerce_metrics(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    days: int = 30,
) -> dict:
    from sellable.metrics import commerce_metrics
    from sellable.repositories import AnalyticsRepository, PromotionRepository

    core = merchant_core(session)
    return commerce_metrics(
        analytics_repo=AnalyticsRepository(),
        promotion_repo=core.promotion_repo,
        merchant_id=session.merchant_id,
        days=days,
    )


@app.get("/ready", tags=["platform"])
@limiter.exempt
def readiness() -> dict:
    """Readiness beyond liveness (§46): database, outbox drainability, and
    payment configuration. Anything failing marks unready for orchestrators."""
    from sellable.repositories import OutboxRepository

    checks: dict[str, object] = {}
    ready = True
    try:
        pending = OutboxRepository().pending_count()
        dead = OutboxRepository().dead_letter_count()
        checks["outbox"] = {"pending": pending, "dead_lettered": dead}
    except Exception as error:  # noqa: BLE001 — readiness reports, never crashes
        ready = False
        checks["outbox"] = {"error": str(error)[:200]}
    try:
        checks["payments"] = {
            "provider": getattr(settings, "payment_provider", "razorpay"),
            "razorpay_configured": settings.razorpay_is_configured,
            "stripe_configured": bool(settings.stripe_secret_key),
        }
    except Exception as error:  # noqa: BLE001
        ready = False
        checks["payments"] = {"error": str(error)[:200]}
    try:
        from sellable.repositories import MerchantRepository

        checks["database"] = {
            "merchants": len(MerchantRepository().list_all(limit=5))
        }
    except Exception as error:  # noqa: BLE001
        ready = False
        checks["database"] = {"error": str(error)[:200]}
    status_code = 200 if ready else 503
    return JSONResponse(status_code=status_code, content={"ready": ready, "checks": checks})


# ---------------------------------------------------------------------------
# Platform administration (target §48): fail-closed admin surface. Without
# SELLABLE_ADMIN_API_KEY every route 404s — there is deliberately no
# "disabled" banner to probe. Reads only; admin writes arrive with the
# billing UI and stay ledger-audited when they do.
# ---------------------------------------------------------------------------

def require_admin(request: Request) -> None:
    import hmac as _hmac

    configured = settings.admin_api_key
    provided = request.headers.get("X-Admin-Key")
    if not configured or not provided or not _hmac.compare_digest(provided, configured):
        raise HTTPException(status_code=404, detail="Not found")


@app.get("/admin/overview", tags=["admin"])
@limiter.limit("30/minute")
def admin_overview(request: Request) -> dict:
    require_admin(request)
    from sellable.repositories import MerchantRepository, OutboxRepository

    merchants = MerchantRepository().list_all(limit=500)
    outbox = OutboxRepository()
    return {
        "merchants": len(merchants),
        "outbox_pending": outbox.pending_count(),
        "outbox_dead_lettered": outbox.dead_letter_count(),
    }


@app.get("/admin/merchants", tags=["admin"])
@limiter.limit("30/minute")
def admin_merchants(request: Request, limit: int = 100) -> list:
    require_admin(request)
    from sellable.platform_billing import resolve_plan, summarize_usage
    from sellable.repositories import (
        MerchantRepository,
        ObservabilityRepository,
        OrderRepository,
    )

    result = []
    for merchant in MerchantRepository().list_all(limit=limit):
        usage = summarize_usage(
            order_repo=OrderRepository(),
            observability_repo=ObservabilityRepository(),
            ledger=LedgerRepository(),
            merchant_id=merchant.merchant_id,
            plan=resolve_plan(merchant.merchant_id),
        )
        result.append(
            {
                "merchant_id": merchant.merchant_id,
                "name": merchant.name,
                "created_at": merchant.created_at.isoformat()
                if merchant.created_at
                else None,
                "billing": usage,
            }
        )
    return result


@app.get("/admin/incidents", tags=["admin"])
@limiter.limit("30/minute")
def admin_incidents(request: Request, limit: int = 50) -> dict:
    require_admin(request)
    from sellable.repositories import FraudRepository, OutboxRepository, RiskRepository

    return {
        "fraud": [
            {
                "kind": f.kind.value,
                "merchant_id": f.merchant_id,
                "subject_id": f.subject_id,
                "created_at": f.created_at.isoformat(),
            }
            for f in FraudRepository().list_recent_all(limit=limit)
        ],
        "risk_blocks": [
            {
                "decision_id": r.decision_id,
                "merchant_id": r.merchant_id,
                "reasons": r.reasons,
                "created_at": r.created_at.isoformat(),
            }
            for r in RiskRepository().recent_all(limit=limit)
            if r.level.value == "BLOCK"
        ],
        "dead_letters": OutboxRepository().list_dead_letters(None, limit=limit),
    }


@app.post(
    "/webhooks/stripe",
    tags=["payments"],
    summary="Verify and reconcile a Stripe test-mode webhook.",
)
@limiter.limit("120/minute")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> dict:
    """Second provider rail (§25): HMAC-verified Stripe events settle the
    same deterministic order machine. Test mode only."""
    from sellable.payments.stripe import (
        InvalidStripeSignatureError,
        StripeConfigurationError,
    )

    body = await request.body()
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from error
    from sellable.payments import build_provider

    adapter = build_provider(settings, "stripe")
    try:
        adapter.verify_webhook(body, stripe_signature)
    except InvalidStripeSignatureError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except StripeConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    event_type = payload.get("type", "")
    entity = payload.get("data", {}).get("object", {}) or {}
    if event_type not in ("payment_intent.succeeded", "payment_intent.payment_failed"):
        return {"status": "ignored", "event_type": event_type}
    local_order_id = (entity.get("metadata") or {}).get("local_order_id")
    if not local_order_id:
        raise HTTPException(status_code=400, detail="Missing local_order_id metadata")
    core = registry.get(_merchant_for_order(local_order_id))
    try:
        if event_type == "payment_intent.succeeded":
            order = core.mark_paid(
                local_order_id, provider_ref=str(entity.get("id", ""))
            )
        else:
            order = core.mark_payment_failed(
                local_order_id,
                reason=str(entity.get("last_payment_error", {}).get("message") or "stripe declined"),
                provider_ref=str(entity.get("id", "")),
            )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    _drain_bus_best_effort()
    return {"status": order.status.value, "order_id": order.order_id}


def _merchant_for_order(order_id: str) -> str:
    """Resolve the owning merchant for a provider-referenced order without
    leaking cross-tenant existence (unknown ids fall through to the demo
    resolution path, which 404s identically)."""
    from sellable.repositories import OrderRepository

    order = OrderRepository().get(order_id)
    if order is not None:
        return order.merchant_id
    return DEMO_MERCHANT_ID


@app.get("/console/connectors", tags=["console"])
@limiter.limit("60/minute")
def console_connectors(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> list:
    core = merchant_core(session)
    return core.connector_list()


@app.post("/console/connectors", tags=["console"])
@limiter.limit("30/minute")
def console_connector_register(
    request: Request,
    body: dict,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> dict:
    from sellable.connectors.base import ConnectorConfig

    for field_name in ("connector_id", "provider"):
        if not body.get(field_name):
            raise HTTPException(status_code=400, detail=f"{field_name} is required")
    if body.get("provider") != "custom_rest":
        raise HTTPException(
            status_code=400,
            detail="Only the custom_rest provider is onboarded in this release",
        )
    core = merchant_core(session)
    try:
        config = ConnectorConfig(
            connector_id=str(body["connector_id"]),
            merchant_id=session.merchant_id,
            kind=str(body.get("kind") or "commerce"),
            provider="custom_rest",
            base_url=str(body.get("base_url") or ""),
            products_path=str(body.get("products_path") or "/products"),
            field_map=dict(body.get("field_map") or {}),
            timeout_seconds=int(body.get("timeout_seconds") or 15),
            active=True,
        )
        return core.connector_register(
            config, trace_id=resolve_trace_id(x_trace_id)
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.delete("/console/connectors/{connector_id}", tags=["console"])
@limiter.limit("30/minute")
def console_connector_delete(
    connector_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> dict:
    core = merchant_core(session)
    try:
        core.connector_remove(connector_id, trace_id=resolve_trace_id(x_trace_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"connector_id": connector_id, "status": "DELETED"}


@app.get("/console/connectors/{connector_id}/health", tags=["console"])
@limiter.limit("30/minute")
def console_connector_health(
    connector_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> dict:
    core = merchant_core(session)
    try:
        return core.connector_health(connector_id, trace_id=resolve_trace_id(x_trace_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/console/connectors/{connector_id}/sync", tags=["console"])
@limiter.limit("10/minute")
def console_connector_sync(
    connector_id: str,
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> dict:
    core = merchant_core(session)
    try:
        return core.connector_sync(connector_id, trace_id=resolve_trace_id(x_trace_id))
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:  # noqa: BLE001 — source failures are 502s
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/console/billing", tags=["console"])
@limiter.limit("60/minute")
def console_billing(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
    days: int = 30,
) -> dict:
    from sellable.platform_billing import resolve_plan, summarize_usage
    from sellable.repositories import ObservabilityRepository, OrderRepository

    return summarize_usage(
        order_repo=OrderRepository(),
        observability_repo=ObservabilityRepository(),
        ledger=LedgerRepository(),
        merchant_id=session.merchant_id,
        plan=resolve_plan(
            session.merchant_id,
            override=os.getenv("SELLABLE_DEFAULT_PLAN"),
        ),
        days=days,
    )


@app.get("/.well-known/agents.json", tags=["agent-gateway"])
@limiter.exempt
def agent_manifest(gateway: AgentGateway = Depends(get_agent_gateway)) -> dict[str, object]:
    return gateway.discovery_manifest()


@app.get("/llms.txt", response_class=PlainTextResponse, tags=["agent-gateway"])
@limiter.exempt
def llms_instructions(gateway: AgentGateway = Depends(get_agent_gateway)) -> str:
    return gateway.llms_instructions()


@app.get("/catalog.ai.json", tags=["agent-gateway"])
@limiter.exempt
def agent_catalog(gateway: AgentGateway = Depends(get_agent_gateway)) -> dict[str, object]:
    return gateway.catalog_document()


@app.post("/agent/catalog.search", response_model=list[Product], tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_catalog_search(
    request: Request,
    body: CatalogSearchRequest,
    gateway: AgentGateway = Depends(get_agent_gateway),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> list[Product]:
    return gateway.search_catalog(body)


@app.post("/agent/catalog.get", response_model=Product, tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_catalog_get(
    request: Request,
    body: CatalogGetRequest,
    gateway: AgentGateway = Depends(get_agent_gateway),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> Product:
    try:
        return gateway.get_catalog_item(body.sku)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/agent/quotes.create", response_model=SellerDecision, tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_quote_create(
    request: Request,
    body: SellerRequest,
    gateway: AgentGateway = Depends(get_agent_gateway),
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> SellerDecision:
    trace_id = resolve_trace_id(x_trace_id)
    # Quotes need an ALLOW delegation; holds must resolve before quoting.
    _gate_delegation(
        commerce,
        delegation_id=x_delegation_id,
        scope=OperationScope.CART_WRITE,
        amount_paise=None,
        trace_id=trace_id,
        route="agent.quotes.create",
        hold_status=403,
    )
    return gateway.create_quote(body, trace_id=trace_id)


@app.post("/agent/quotes.negotiate", response_model=SellerDecision, tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_quote_negotiate(
    request: Request,
    body: SellerRequest,
    gateway: AgentGateway = Depends(get_agent_gateway),
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> SellerDecision:
    trace_id = resolve_trace_id(x_trace_id)
    _gate_delegation(
        commerce,
        delegation_id=x_delegation_id,
        scope=OperationScope.CART_WRITE,
        amount_paise=None,
        trace_id=trace_id,
        route="agent.quotes.negotiate",
        hold_status=403,
    )
    return gateway.create_quote(body, trace_id=trace_id)


@app.post(
    "/agent/buyer/run",
    response_model=BuyerResult,
    tags=["buyer-agent"],
    deprecated=True,
)
@limiter.limit("10/minute")
def buyer_run(
    request: Request,
    mission: BuyerMission,
    agent: BuyerAgent = Depends(get_buyer_agent),
    # The reference buyer creates real orders + consents: signed-only
    # outside dev/test, like every mutating agent route.
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
) -> BuyerResult:
    result = agent.run(mission, trace_id=resolve_trace_id(x_trace_id))
    return _with_mission_id(commerce_core.merchant_scope, mission, result)


@app.post("/agent/consents.request", tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_consents_request(
    request: Request,
    body: ConsentRequest,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    trace_id = resolve_trace_id(x_trace_id)
    try:
        order = commerce.get_order(body.order_id)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    _gate_delegation(
        commerce,
        delegation_id=x_delegation_id,
        scope=OperationScope.CHECKOUT_WRITE,
        amount_paise=order.amount_paise,
        trace_id=trace_id,
        route="agent.consents.request",
    )
    try:
        consent = commerce.issue_consent(body.order_id)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {
        "consent_id": consent.consent_id,
        "order_id": consent.order_id,
        "amount_paise": consent.amount_paise,
        "payee_id": consent.payee_id,
        "purpose": consent.purpose,
        "expires_at": consent.expires_at.isoformat(),
        "single_use": consent.single_use,
        "status": consent.status,
    }


@app.post("/agent/orders.create", tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_order_create(
    request: Request,
    body: OrderCreateRequest,
    gateway: AgentGateway = Depends(get_agent_gateway),
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
    x_trace_id: str | None = Header(default=None),
    x_delegation_id: str | None = Header(default=None),
) -> dict:
    from agents.seller.agent import SellerRequest

    # One stable trace per client flow (X-Trace-Id header > body trace_id).
    # Fast-path replay only when the caller repeats the same trace: the same
    # key with a different cart/message must go through the core guard below,
    # which raises IdempotencyReuseError instead of returning another
    # transaction's order.
    trace_id = resolve_trace_id(x_trace_id, body_trace_id=body.trace_id)
    _gate_delegation(
        commerce,
        delegation_id=x_delegation_id,
        scope=OperationScope.CHECKOUT_WRITE,
        amount_paise=None,
        trace_id=trace_id,
        route="agent.orders.create",
    )
    pre_existing = commerce.get_order_by_idempotency_key(body.idempotency_key)
    if pre_existing is not None and pre_existing.trace_id == trace_id:
        return {
            "order_id": pre_existing.order_id,
            "trace_id": pre_existing.trace_id,
            "status": pre_existing.status,
            "amount_paise": pre_existing.amount_paise,
            "quote_id": pre_existing.quote_id,
            "idempotency_key": pre_existing.idempotency_key,
            "replayed": True,
        }

    decision = gateway.create_quote(
        SellerRequest(
            message=body.message,
            intent=body.intent,
            requested_sku=body.requested_sku,
            quantity=body.quantity,
            buyer_offer_paise=body.buyer_offer_paise,
            request_upsell=body.request_upsell,
        ),
        trace_id=trace_id,
    )
    if (
        decision.cart is None
        or decision.policy_decision is None
        or decision.policy_decision.verdict is PolicyVerdict.DENY
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Order creation blocked by policy: {decision.policy_decision.reason_code if decision.policy_decision else 'NO_MATCH'}",
        )
    try:
        order = commerce.create_order(
            cart=decision.cart,
            intent=body.intent,
            trace_id=trace_id,
            idempotency_key=body.idempotency_key,
            delegation_id=x_delegation_id,
        )
    except IdempotencyReuseError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        # Policy denial or a lost create_order race — never a 500.
        raise HTTPException(status_code=409, detail=str(error)) from error
    if pre_existing is not None and pre_existing.order_id == order.order_id:
        return {
            "order_id": order.order_id,
            "trace_id": order.trace_id,
            "status": order.status,
            "amount_paise": order.amount_paise,
            "quote_id": order.quote_id,
            "idempotency_key": order.idempotency_key,
            "replayed": True,
        }
    return {
        "order_id": order.order_id,
        "trace_id": order.trace_id,
        "status": order.status,
        "amount_paise": order.amount_paise,
        "quote_id": order.quote_id,
        "idempotency_key": order.idempotency_key,
        "requires_approval": order.requires_approval,
    }


@app.post("/agent/orders.status", tags=["agent-gateway"])
@limiter.limit("60/minute")
def agent_order_status(
    request: Request,
    body: OrderStatusRequest,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> dict:
    try:
        order = commerce.get_order(body.order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {
        "order_id": order.order_id,
        "status": order.status,
        "amount_paise": order.amount_paise,
        "payment_id": commerce.ledger.last_provider_ref(order.trace_id, action="order.paid"),
        "trace_id": order.trace_id,
    }


@app.post("/agent/refunds.create", tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_refunds_create(
    request: Request,
    body: RefundCreateRequest,
    refunds: RefundService = Depends(get_refund_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    require_owner(session)
    core = merchant_core(session)
    try:
        return refunds.initiate_refund(
            order_id=body.order_id,
            reason=body.reason,
            amount_paise=body.amount_paise,
            idempotency_key=body.idempotency_key,
            commerce=core,
        )
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RazorpayRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except UnexpectedOrderStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post(
    "/orders/{order_id}/payment",
    response_model=PaymentAttempt,
    tags=["payments"],
    summary="Start a Razorpay test-mode order after consuming exact consent.",
)
@limiter.limit("10/minute")
def start_payment(
    request: Request,
    order_id: str,
    body: PaymentStartRequest,
    payments: PaymentService = Depends(get_payment_service),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
) -> PaymentAttempt:
    try:
        return payments.start_payment(order_id=order_id, consent_id=body.consent_id)
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RazorpayRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post(
    "/orders/{order_id}/payment/retry",
    response_model=PaymentAttempt,
    tags=["payments"],
    summary="Perform one bounded, idempotent retry after a verified payment failure.",
)
@limiter.limit("10/minute")
def retry_payment(
    request: Request,
    order_id: str,
    payments: PaymentService = Depends(get_payment_service),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
) -> PaymentAttempt:
    try:
        return payments.retry_payment(order_id=order_id)
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RazorpayRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post(
    "/webhooks/razorpay",
    response_model=PaymentAttempt,
    tags=["payments"],
    summary="Verify and reconcile a Razorpay payment webhook.",
)
# Not exempt: the one unauthenticated HMAC-verifying endpoint still gets a
# generous per-IP bucket against floods and signature-probing. Genuine
# provider retries sit far below 120/minute.
@limiter.limit("120/minute")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str | None = Header(default=None),
    payments: PaymentService = Depends(get_payment_service),
) -> PaymentAttempt:
    body = await request.body()
    try:
        attempt = payments.handle_webhook(body, x_razorpay_signature)
    except InvalidWebhookSignatureError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except UnexpectedOrderStateError as error:
        # Verified money event for an order that cannot legally move — needs
        # manual reconciliation, not a retry storm.
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (UnknownProviderOrderError, UnsupportedWebhookEventError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    # Verified settlement fans out asynchronously: analytics, merchant
    # notifications, fulfillment, and trust update off the durable outbox.
    _drain_bus_best_effort()
    return attempt


@app.post(
    "/orders/{order_id}/refund",
    tags=["payments"],
    summary="Issue a refund for a paid order.",
)
@limiter.limit("10/minute")
def refund_order(
    request: Request,
    order_id: str,
    # Same edge contract as the agent path's RefundCreateRequest: invalid
    # values 422 here too instead of slipping through to a 400/502 downstream.
    reason: str = Query(default="merchant_initiated", min_length=1, max_length=500),
    amount_paise: int | None = Query(default=None, gt=0),
    idempotency_key: str | None = Query(default=None, min_length=16, max_length=256),
    refunds: RefundService = Depends(get_refund_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    require_owner(session)
    core = merchant_core(session)
    try:
        # A merchant-scoped core only knows its own orders, so foreign
        # order ids fail with a 404-equivalent ownership error.
        # Full amount by default; partial refunds keep the order PAID.
        return refunds.initiate_refund(
            order_id=order_id,
            reason=reason,
            amount_paise=amount_paise,
            idempotency_key=idempotency_key,
            commerce=core,
        )
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RazorpayRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except UnexpectedOrderStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# ---------------------------------------------------------------------------
# Development-only webhook simulation (never enabled in production)
#
# These helpers drive the *same* verified `handle_webhook` boundary used by
# real Razorpay events so local demos can complete the captured/failed flow
# without an external tunnel. They are inert in production.
# ---------------------------------------------------------------------------


def _signed_webhook(payload: dict[str, object]) -> tuple[bytes, str]:
    import hashlib
    import hmac
    import json as _json

    if not settings.razorpay_webhook_secret:
        raise RazorpayConfigurationError("Razorpay webhook secret is not configured")
    body = _json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(
        settings.razorpay_webhook_secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    return body, signature


def _simulate_provider_event(
    payments: PaymentService, core: CommerceCore, order_id: str, event: str
) -> PaymentAttempt:
    from uuid import uuid4

    if not settings.is_dev_environment:
        raise HTTPException(status_code=403, detail="Webhook simulation is disabled in production")
    # Merchant-scoped resolution: a foreign order_id is invisible (404),
    # exactly like every other console endpoint — never the global demo core.
    try:
        order = core.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    attempt = payments._attempt_by_order_id.get(order_id)
    if attempt is None:
        # Restart-safe: rebuild from the persisted provider refs instead of
        # failing just because process memory was lost.
        if order.provider_link_id is None:
            raise HTTPException(status_code=409, detail="No payment attempt exists for this order")
        attempt = PaymentAttempt(
            order_id=order_id,
            provider_order_id=order.provider_link_id,
            idempotency_key=order.idempotency_key,
        )
        payments._attempt_by_order_id[order_id] = attempt
    payment_entity = {
        "id": f"pay_sim_{uuid4().hex[:12]}",
        "order_id": attempt.provider_order_id,
        "status": "captured" if event == "payment.captured" else "failed",
        "amount": order.amount_paise,
    }
    if event == "payment.failed":
        payment_entity["error_description"] = "Payment declined in Razorpay Test Mode (simulated)."
    payload = {"event": event, "payload": {"payment": {"entity": payment_entity}}}
    body, signature = _signed_webhook(payload)
    try:
        # Flagged as simulated so the ledger narrates demo money honestly.
        return payments.handle_webhook(body, signature, extra_flags=["simulated"])
    except UnexpectedOrderStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (UnknownProviderOrderError, UnsupportedWebhookEventError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post(
    "/console/orders/{order_id}/simulate-capture",
    response_model=PaymentAttempt,
    tags=["console"],
    summary="(Dev only) Settle an order via the verified webhook boundary.",
)
@limiter.limit("20/minute")
def console_simulate_capture(
    request: Request,
    order_id: str,
    payments: PaymentService = Depends(get_payment_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> PaymentAttempt:
    return _simulate_provider_event(payments, merchant_core(session), order_id, "payment.captured")


@app.post(
    "/console/orders/{order_id}/simulate-failure",
    response_model=PaymentAttempt,
    tags=["console"],
    summary="(Dev only) Fail an order via the verified webhook boundary.",
)
@limiter.limit("20/minute")
def console_simulate_failure(
    request: Request,
    order_id: str,
    payments: PaymentService = Depends(get_payment_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> PaymentAttempt:
    return _simulate_provider_event(payments, merchant_core(session), order_id, "payment.failed")


# ---------------------------------------------------------------------------
# Console API endpoints (merchant dashboard)
# ---------------------------------------------------------------------------


def _summarize_order(
    order: "ConsoleTransactionItem | object",
    events: list,
    consent_lookup=None,
) -> dict[str, object]:
    """Derive merchant-facing policy/consent/payment/item facts from the ledger.

    The frontend never computes these states; it renders the backend's
    authoritative summary, which is reconstructed from the XAI Ledger (§9).

    ``consent_lookup`` (consent_id → live Consent) lets the summary consult
    the authoritative consent record: consent expiry and consume-by-another-
    path do NOT write ledger events, so an event-only read kept reporting a
    dead consent as ISSUED — the exact bug behind the stale START PAYMENT
    button and the "Consent is not available for use" 409 loop.
    """
    order_id = getattr(order, "order_id")
    status = getattr(order, "status")

    items: list[dict[str, object]] = []
    buyer_budget_paise: int | None = None
    policy_verdict: str | None = None
    policy_reason: str | None = None
    policy_refs: list[str] = []
    policy_explanation: str | None = None
    consent_id: str | None = None
    consent_expires_at: str | None = None
    consent_issued = False
    consent_used = False
    payment_order_id: str | None = None
    payment_status: str | None = None
    payment_id: str | None = None

    for e in events:
        output = e.output_json or {}
        if e.action == "order.created":
            items = output.get("items") or items
            buyer_budget_paise = output.get("buyer_budget_paise") or buyer_budget_paise
        elif e.action == "policy.checked":
            policy_verdict = output.get("verdict") or policy_verdict
            policy_reason = output.get("reason_code") or policy_reason
            policy_refs = e.policy_refs_json or policy_refs
            policy_explanation = e.reasoning_summary or policy_explanation
            buyer_budget_paise = (e.inputs_json or {}).get("buyer_budget_paise") or buyer_budget_paise
        elif e.action == "consent.issued":
            consent_issued = True
            consent_id = output.get("consent_id") or consent_id
            consent_expires_at = output.get("expires_at") or consent_expires_at
        elif e.action == "consent.used":
            consent_used = True
        elif e.action == "payment.attempted":
            payment_order_id = output.get("provider_order_id") or payment_order_id
        elif e.action in ("webhook.reconciled", "payment.captured", "payment.failed"):
            payment_status = output.get("status") or payment_status
            payment_id = e.provider_ref or payment_id
        elif e.action == "order.paid":
            payment_status = payment_status or "CAPTURED"
            payment_id = e.provider_ref or payment_id

    if payment_status is None and status in ("PAYMENT_PENDING",):
        payment_status = "PAYMENT_PENDING"
    if payment_status is None and status in ("PAID", "FULFILLED"):
        payment_status = "CAPTURED"
    if payment_status is None and status in ("PAYMENT_FAILED", "ABORTED", "REFUNDED"):
        payment_status = "FAILED"

    # Display vocabulary: the Consent record enum uses USED, but every
    # order/transaction summary surfaces the same state as CONSUMED (the
    # consent was spent). Treat them as one token: USED (record) ==
    # CONSUMED (summary). New code must compare against both.
    if consent_used:
        consent_status = "CONSUMED"
    elif consent_issued:
        consent_status = "ISSUED"
        if consent_id and consent_lookup is not None:
            try:
                live = consent_lookup(consent_id)
            except Exception:  # noqa: BLE001 — summary must not fail on lookup
                live = None
            if live is not None:
                if live.status is ConsentStatus.USED:
                    consent_status = "CONSUMED"
                elif live.status is ConsentStatus.EXPIRED:
                    consent_status = "EXPIRED"
                elif live.status is ConsentStatus.REVOKED:
                    consent_status = "REVOKED"
                elif live.expires_at <= datetime.now(timezone.utc):
                    consent_status = "EXPIRED"
        if consent_status == "ISSUED" and consent_expires_at:
            # Expiry writes NO ledger event, so also check the recorded
            # expiry truthfully instead of reporting ISSUED forever.
            try:
                expires = datetime.fromisoformat(
                    str(consent_expires_at).replace("Z", "+00:00")
                )
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if expires <= datetime.now(timezone.utc):
                    consent_status = "EXPIRED"
            except ValueError:
                pass
    elif status in ("AWAITING_CONSENT",):
        consent_status = "NOT_ISSUED"
    else:
        consent_status = "ISSUED" if consent_issued else None

    buyer_agent_id = getattr(order, "buyer_agent_id") or ""
    channel = "agent_to_agent" if buyer_agent_id.startswith("buyer_") else "human_chat"

    return {
        "channel": channel,
        "items": items,
        "policy_verdict": policy_verdict,
        "policy_reason": policy_reason,
        "policy_refs": policy_refs,
        "policy_explanation": policy_explanation,
        "buyer_budget_paise": buyer_budget_paise,
        "consent_id": consent_id,
        "consent_status": consent_status,
        "consent_expires_at": consent_expires_at,
        "payment_status": payment_status,
        "payment_order_id": payment_order_id,
        "payment_id": payment_id,
    }


def _enrich_transaction(
    order: "ConsoleTransactionItem | object",
    ledger: LedgerRepository,
    merchant_id: str | None = None,
    consent_lookup=None,
) -> dict[str, object]:
    events = ledger.for_trace(getattr(order, "trace_id"), merchant_id=merchant_id)
    return _summarize_order(order, list(events), consent_lookup)


@app.get("/console/transactions", response_model=list[ConsoleTransactionItem], tags=["console"])
@app.get("/transactions", response_model=list[ConsoleTransactionItem], tags=["console"])
@limiter.limit("60/minute")
def console_transactions(
    request: Request,
    limit: int = 500,
    offset: int = 0,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> list[ConsoleTransactionItem]:
    core = merchant_core(session)
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    orders = core.all_orders(limit=limit, offset=offset)
    sorted_orders = sorted(orders, key=lambda x: x.created_at, reverse=True)
    # ONE ledger query for all traces (was one query per order).
    batched = ledger.events_for_traces(
        [o.trace_id for o in sorted_orders], merchant_id=session.merchant_id
    )
    enriched: list[ConsoleTransactionItem] = []
    for o in sorted_orders:
        base = ConsoleTransactionItem(
            order_id=o.order_id,
            trace_id=o.trace_id,
            status=o.status,
            amount_paise=o.amount_paise,
            buyer_agent_id=o.buyer_agent_id,
            merchant_id=o.merchant_id,
            quote_id=o.quote_id,
            idempotency_key=o.idempotency_key,
            created_at=o.created_at,
            payment_url=o.provider_payment_url,
        )
        enriched.append(
            ConsoleTransactionItem.model_validate(
                {
                    **base.model_dump(),
                    **_summarize_order(
                        o, batched.get(o.trace_id, []), core.consent_service.get
                    ),
                }
            )
        )
    return enriched


@app.get("/console/transactions/{order_id}", response_model=ConsoleTransactionDetail, tags=["console"])
@app.get("/transactions/{order_id}", response_model=ConsoleTransactionDetail, tags=["console"])
@limiter.limit("60/minute")
def console_transaction_detail(
    request: Request,
    order_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> ConsoleTransactionDetail:
    core = merchant_core(session)
    try:
        order = core.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    events = ledger.for_trace(order.trace_id, merchant_id=session.merchant_id)
    base = ConsoleTransactionDetail(
        order_id=order.order_id,
        trace_id=order.trace_id,
        status=order.status,
        amount_paise=order.amount_paise,
        buyer_agent_id=order.buyer_agent_id,
        merchant_id=order.merchant_id,
        quote_id=order.quote_id,
        idempotency_key=order.idempotency_key,
        created_at=order.created_at,
        payment_url=order.provider_payment_url,
    )
    enriched = _enrich_transaction(
        order, ledger, session.merchant_id, consent_lookup=core.consent_service.get
    )
    return ConsoleTransactionDetail.model_validate(
        {
            **base.model_dump(),
            **enriched,
            "events": [
                {
                    "event_id": e.event_id,
                    "trace_id": e.trace_id,
                    "timestamp": e.timestamp.isoformat(),
                    "actor": e.actor,
                    "action": e.action,
                    "inputs": e.inputs_json,
                    "output": e.output_json,
                    "reasoning_summary": e.reasoning_summary,
                    "policy_refs": e.policy_refs_json,
                    "outcome_effect": e.outcome_effect_json,
                    "provider_ref": e.provider_ref,
                    "flags": e.flags_json,
                }
                for e in events
            ],
        }
    )


# Live SSE stream registry: stream id -> connected epoch seconds. Lets
# operators (and tests) observe how many streams are actually open; the
# registry never holds sessions, engines, or credentials.
_active_sse_streams: dict[str, float] = {}
_active_sse_lock = threading.Lock()

#: Streams close themselves after this long so zombies cannot accumulate
#: across deploys and proxy hiccups; clients reconnect within their bounded
#: budget (the console falls back to polling).
SSE_MAX_LIFETIME_SECONDS = 15 * 60


@app.get("/activity/stream", tags=["console"])
@limiter.limit("30/minute")
async def activity_stream(
    request: Request,
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
):
    """Server-Sent Events stream of new ledger activity (§46), scoped to the merchant.

    Execution model (deliberate, non-blocking):
    - the handler itself is async and never occupies a sync worker thread;
    - every DB read is a short-lived session offloaded to a worker thread;
    - the loop idles 1s between polls and self-terminates on disconnect or
      after SSE_MAX_LIFETIME_SECONDS, so one stream can neither starve other
      requests nor live forever.
    """
    import anyio
    import asyncio
    import json
    import time as _time
    import uuid as _uuid

    stream_id = f"sse_{_uuid.uuid4().hex[:12]}"
    with _active_sse_lock:
        _active_sse_streams[stream_id] = _time.time()
        active_count = len(_active_sse_streams)
    logger.info(
        "SSE stream connected id=%s merchant=%s active=%d",
        stream_id,
        session.merchant_id,
        active_count,
    )

    async def event_generator():
        try:
            # Blocking SQLAlchemy calls must not run on the event loop:
            # offload them to worker threads (one stream polls per client).
            last_sequence = await anyio.to_thread.run_sync(ledger.max_sequence)
            # Immediate handshake byte: a client that never receives a first
            # frame cannot distinguish "healthy idle stream" from "hung
            # backend", and readers/tests would block indefinitely.
            yield ": connected\n\n"
            deadline = _time.time() + SSE_MAX_LIFETIME_SECONDS
            while True:
                if await request.is_disconnected():
                    break
                if _time.time() >= deadline:
                    logger.info("SSE stream closing at max lifetime id=%s", stream_id)
                    break
                try:
                    events = await anyio.to_thread.run_sync(
                        lambda: ledger.events_after(
                            last_sequence, limit=100, merchant_id=session.merchant_id
                        )
                    )
                    for record in events:
                        yield "data: " + json.dumps(
                            {
                                "event_id": record.event_id,
                                "trace_id": record.trace_id,
                                "timestamp": record.timestamp.isoformat(),
                                "actor": record.actor,
                                "action": record.action,
                                "inputs": record.inputs_json,
                                "output": record.output_json,
                                "reasoning_summary": record.reasoning_summary,
                                "policy_refs": record.policy_refs_json,
                                "provider_ref": record.provider_ref,
                                "flags": record.flags_json,
                            }
                        ) + "\n\n"
                        last_sequence = record.sequence
                except asyncio.CancelledError:
                    raise
                except Exception:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(1)
        finally:
            with _active_sse_lock:
                _active_sse_streams.pop(stream_id, None)
                remaining = len(_active_sse_streams)
            logger.info("SSE stream disconnected id=%s active=%d", stream_id, remaining)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/console/events", tags=["console"])
@app.get("/activity", tags=["console"])
@limiter.limit("60/minute")
def console_events(
    request: Request,
    limit: int = 200,
    offset: int = 0,
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    events = ledger.all_events(limit=limit, offset=offset, merchant_id=session.merchant_id)
    total = ledger.count_events(merchant_id=session.merchant_id)
    return {
        "events": [
            {
                "event_id": e.event_id,
                "trace_id": e.trace_id,
                "timestamp": e.timestamp.isoformat(),
                "actor": e.actor,
                "action": e.action,
                "inputs": e.inputs_json,
                "output": e.output_json,
                "reasoning_summary": e.reasoning_summary,
                "policy_refs": e.policy_refs_json,
                "outcome_effect": e.outcome_effect_json,
                "provider_ref": e.provider_ref,
                "flags": e.flags_json,
            }
            for e in events
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/console/approvals", response_model=list[ConsoleApprovalRequest], tags=["console"])
@app.get("/approvals", response_model=list[ConsoleApprovalRequest], tags=["console"])
@limiter.limit("60/minute")
def console_approvals(
    request: Request,
    limit: int = 500,
    offset: int = 0,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> list[ConsoleApprovalRequest]:
    from sellable.contracts import OrderStatus

    core = merchant_core(session)
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    orders = core.all_orders()
    held = [
        order
        for order in orders
        if order.requires_approval
        and order.status in (OrderStatus.AWAITING_CONSENT,)
    ][offset : offset + limit]
    # ONE ledger query for all held traces (was one query per order).
    batched = ledger.events_for_traces(
        [order.trace_id for order in held], merchant_id=session.merchant_id
    )
    approvals: list[ConsoleApprovalRequest] = []
    for order in held:
        events = batched.get(order.trace_id, [])
        policy_event = None
        for e in events:
            if e.action == "policy.checked":
                policy_event = e
                break
        reason = "NEEDS_HUMAN_APPROVAL"
        if policy_event and policy_event.output_json.get("reason_code"):
            reason = policy_event.output_json["reason_code"]
        approvals.append(
            ConsoleApprovalRequest(
                order_id=order.order_id,
                buyer_agent_id=order.buyer_agent_id,
                amount_paise=order.amount_paise,
                reason=reason,
                requested_at=order.created_at,
                status="PENDING",
            )
        )
    return approvals


@app.post("/console/approvals/{order_id}/approve", tags=["console"])
@app.post("/approvals/{order_id}/approve", tags=["console"])
@limiter.limit("30/minute")
def console_approve_order(
    request: Request,
    order_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    # Trust model (P3-13, intentional): member-level approval. Approvals are the
    # day-to-day operational queue; owner-only gates stay on policy changes and
    # money-out (refunds via require_owner). Capture still needs a real payer.
    core = merchant_core(session)
    # Validate issuability BEFORE the approval side effect: approve_order
    # writes DB + ledger, so a subsequent issue_consent failure must not
    # leave an "approved" order behind a 400 response.
    try:
        order = core.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    if order.status is not OrderStatus.AWAITING_CONSENT:
        raise HTTPException(
            status_code=400,
            detail=f"Only orders awaiting consent can be approved; current status is {order.status}",
        )
    if not order.requires_approval:
        raise HTTPException(
            status_code=400, detail="Order does not require merchant approval"
        )
    if core.consent_service.active_for_order(order.order_id) is not None:
        raise HTTPException(
            status_code=400, detail="A consent is already active for this order"
        )
    try:
        core.approve_order(order_id)
        consent = core.issue_consent(order_id)
        # The mission row is a pointer, not a second state machine: this
        # only refreshes its consent link / last-known state so the AI
        # Buyer mission is resumable as payment-ready after a restart.
        # Money state stays on the order; the continuation endpoint
        # re-derives everything from it.
        mission_id: str | None = None
        try:
            buyer_mission_service.note_approval(
                merchant_id=session.merchant_id,
                order_id=order_id,
                consent_id=consent.consent_id,
            )
            mission_row = buyer_mission_service.find_for_order(
                session.merchant_id, order_id
            )
            mission_id = mission_row.mission_id if mission_row else None
        except Exception as exc:  # noqa: BLE001 — pointer refresh is additive
            logger.warning("Buyer mission approval refresh failed: %s", exc)
        return {
            "status": "approved",
            "order_id": order_id,
            "consent_id": consent.consent_id,
            # Only AI-buyer missions carry a mission_id — the console uses
            # it to resume the A2A continuation (never the human chat flow).
            "mission_id": mission_id,
        }
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/console/approvals/{order_id}/reject", tags=["console"])
@app.post("/approvals/{order_id}/reject", tags=["console"])
@limiter.limit("30/minute")
def console_reject_order(
    request: Request,
    order_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    payments: PaymentService = Depends(get_payment_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    # Trust model (P3-13, intentional): members may reject/abort held orders, mirroring
    # approve — both are operational queue actions, not config or money-out.
    core = merchant_core(session)
    try:
        order = core.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    if order.status is OrderStatus.PAYMENT_PENDING and order.provider_link_id:
        # A live provider link exists: cancel it first so the aborted order
        # can never be paid afterwards. Fail closed — no abort while the
        # link may still be payable.
        try:
            payments.cancel_provider_link(order_id, commerce=core)
        except (RazorpayConfigurationError, RazorpayRequestError) as error:
            raise HTTPException(
                status_code=502,
                detail=f"Could not cancel the live payment link: {error}",
            ) from error
    try:
        core.mark_aborted(order_id, reason="Order rejected by merchant via console.")
        return {"status": "rejected", "order_id": order_id}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/console/orders/{order_id}/fulfill", tags=["console"])
@app.post("/orders/{order_id}/fulfill", tags=["console"])
@limiter.limit("30/minute")
def console_fulfill_order(
    request: Request,
    order_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    """Mark a paid order fulfilled (PAID → FULFILLED + ledger event)."""
    # Trust model (P3-13, intentional): members may fulfill. Only PAID orders can
    # move, and PAID itself requires a verified payer webhook — no money is created here.
    core = merchant_core(session)
    try:
        core.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    try:
        order = core.mark_fulfilled(order_id)
        return {"status": order.status, "order_id": order_id}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/console/insights", response_model=ConsoleGrowthMetrics, tags=["console"])
@app.get("/growth", response_model=ConsoleGrowthMetrics, tags=["console"])
@limiter.limit("60/minute")
def console_insights(
    request: Request,
    limit: int = 1000,
    offset: int = 0,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> ConsoleGrowthMetrics:
    from sellable.contracts import OrderStatus

    core = merchant_core(session)
    orders = core.all_orders()
    paid = [o for o in orders if o.status == OrderStatus.PAID]
    revenue = sum(o.amount_paise for o in paid)

    limit = max(1, min(limit, 5000))
    offset = max(0, offset)
    events = ledger.all_events(limit=limit, offset=offset, merchant_id=session.merchant_id)

    # Ledger-derived growth metrics. The seller agent records "upsell.offered"
    # (no "accepted" flag) and "negotiation.countered" (no outcome field), so
    # outcomes are derived from what actually happened on the same trace.
    order_items_by_trace: dict[str, set[str]] = {}
    order_traces: set[str] = set()
    for e in events:
        if e.action == "order.created":
            order_traces.add(e.trace_id)
            skus = {
                str(item.get("sku"))
                for item in (e.output_json or {}).get("items", [])
                if isinstance(item, dict) and item.get("sku")
            }
            order_items_by_trace.setdefault(e.trace_id, set()).update(skus)

    upsell_offers = [e for e in events if e.action in ("upsell.offered", "upsell.suggest")]
    upsell_accepted = sum(
        1
        for e in upsell_offers
        if str((e.output_json or {}).get("upsell_sku") or "")
        in order_items_by_trace.get(e.trace_id, set())
    )

    negotiation_events = [e for e in events if "negotiat" in e.action]
    negotiations = len(negotiation_events)
    negotiation_accepted = sum(1 for e in negotiation_events if e.trace_id in order_traces)
    rounds_by_trace: dict[str, int] = {}
    for e in negotiation_events:
        rounds_by_trace[e.trace_id] = rounds_by_trace.get(e.trace_id, 0) + 1
    countered = sum(max(0, rounds - 1) for rounds in rounds_by_trace.values())
    walked_away = negotiations - negotiation_accepted

    accepted_upsell_traces = {
        e.trace_id
        for e in upsell_offers
        if str((e.output_json or {}).get("upsell_sku") or "")
        in order_items_by_trace.get(e.trace_id, set())
    }

    avg_order = revenue // len(paid) if paid else 0
    upsell_rev = sum(
        o.amount_paise
        for o in paid
        if o.trace_id in accepted_upsell_traces
    )

    return ConsoleGrowthMetrics(
        revenue=revenue,
        agent_assisted_revenue=revenue,
        upsell_revenue=upsell_rev,
        avg_order_value=avg_order,
        total_orders=len(orders),
        upsell_offers=len(upsell_offers),
        upsell_accepted=upsell_accepted,
        negotiations=negotiations,
        negotiated_accepted=negotiation_accepted,
        countered=countered,
        walked_away=walked_away,
    )


@app.get("/console/policy", response_model=ConsolePolicySettings, tags=["console"])
@limiter.limit("60/minute")
def console_policy(
    request: Request,
    commerce: CommerceCore = Depends(get_commerce),
    session: MerchantSession = Depends(get_merchant_session),
) -> ConsolePolicySettings:
    p = merchant_core(session).get_policy()
    return ConsolePolicySettings(
        merchant_id=p.merchant_id,
        currency=p.currency,
        max_order_value_paise=p.max_order_value_paise,
        max_single_item_value_paise=p.max_single_item_value_paise,
        max_discount_percent=p.max_discount_percent,
        allowed_categories=p.allowed_categories,
        max_negotiation_rounds=p.max_negotiation_rounds,
        max_upsells_per_session=p.max_upsells_per_session,
        human_approval_threshold_paise=p.human_approval_threshold_paise,
    )


@app.put("/console/policy", response_model=ConsolePolicySettings, tags=["console"])
@limiter.limit("10/minute")
def console_update_policy(
    request: Request,
    body: ConsolePolicyUpdate,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> ConsolePolicySettings:
    require_owner(session)
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    core = merchant_core(session)
    old_policy = core.policy
    new_policy = MerchantPolicy.model_validate({**old_policy.model_dump(), **updates})
    # Persist to the merchant's real policy row and reload their cached core.
    save_policy_for(new_policy)
    registry.invalidate(session.merchant_id)
    from sellable.contracts import LedgerActor

    core._record(
        trace_id=f"policy_update:{session.merchant_id}",
        actor=LedgerActor.HUMAN,
        action="policy.updated",
        inputs={"old_policy": old_policy.model_dump()},
        output={"new_policy": new_policy.model_dump()},
        reasoning_summary=f"Merchant updated policy fields: {', '.join(updates.keys())}.",
    )
    p = new_policy
    return ConsolePolicySettings(
        merchant_id=p.merchant_id,
        currency=p.currency,
        max_order_value_paise=p.max_order_value_paise,
        max_single_item_value_paise=p.max_single_item_value_paise,
        max_discount_percent=p.max_discount_percent,
        allowed_categories=p.allowed_categories,
        max_negotiation_rounds=p.max_negotiation_rounds,
        max_upsells_per_session=p.max_upsells_per_session,
        human_approval_threshold_paise=p.human_approval_threshold_paise,
    )


@app.get("/transactions/{order_id}/events", tags=["console"])
@limiter.limit("60/minute")
def transaction_events(
    request: Request,
    order_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    core = merchant_core(session)
    try:
        order = core.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    events = ledger.for_trace(order.trace_id, merchant_id=session.merchant_id)
    return {
        "order_id": order_id,
        "trace_id": order.trace_id,
        "events": [
            {
                "event_id": e.event_id,
                "trace_id": e.trace_id,
                "timestamp": e.timestamp.isoformat(),
                "actor": e.actor,
                "action": e.action,
                "inputs": e.inputs_json,
                "output": e.output_json,
                "reasoning_summary": e.reasoning_summary,
                "policy_refs": e.policy_refs_json,
                "outcome_effect": e.outcome_effect_json,
                "provider_ref": e.provider_ref,
                "flags": e.flags_json,
            }
            for e in events
        ],
    }


@app.get("/agents/status", tags=["console"])
@limiter.limit("60/minute")
def agents_status(
    request: Request,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    seller_agent: SellerAgent = Depends(get_seller_agent),
    buyer_agent: BuyerAgent = Depends(get_buyer_agent),
    gateway: AgentGateway = Depends(get_agent_gateway),
    session: MerchantSession = Depends(get_merchant_session),
) -> Response:
    """Report real, backend-driven component state (never hardcoded green).

    Aggregate health only, served from a short per-merchant snapshot cache
    with single-flight rebuilds. Per-stage durations go out as a
    Server-Timing header (stage names only — never secrets or tokens).
    """
    import time as _time

    from fastapi.encoders import jsonable_encoder
    from fastapi.responses import JSONResponse

    from sellable.status import get_cached_status_snapshot

    timings: dict[str, float] = {}
    start = _time.perf_counter()
    core = merchant_core(session)
    timings["merchant"] = (_time.perf_counter() - start) * 1000.0

    def _build() -> dict[str, object]:
        return build_status(
            commerce=core,
            ledger=ledger,
            seller_agent=seller_agent,
            buyer_agent=buyer_agent,
            gateway=gateway,
            llm_adapter=_seller_llm,
            llm_init_error=_llm_init_error,
            timings=timings,
        )

    payload, cached = get_cached_status_snapshot(session.merchant_id, _build)
    timings["total"] = (_time.perf_counter() - start) * 1000.0
    server_timing = "; ".join(
        f"{name};dur={value:.1f}" for name, value in sorted(timings.items())
    )
    return JSONResponse(
        content=jsonable_encoder(payload),
        headers={"Server-Timing": server_timing, "X-Status-Cached": "1" if cached else "0"},
    )


@app.post("/catalog/products", response_model=Product, tags=["console"])
@limiter.limit("10/minute")
def console_create_product(
    request: Request,
    body: Product,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> Product:
    core = merchant_core(session)
    # The product belongs to the authenticated merchant's own store — the
    # merchant_id in the body is never trusted.
    product = body.model_copy(update={"merchant_id": session.merchant_id})
    try:
        CatalogRepository().add(product)
        core.catalog.add_product(product)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    core._record(
        trace_id=f"catalog_update:{session.merchant_id}",
        actor=LedgerActor.HUMAN,
        action="catalog.product_created",
        inputs={
            "sku": product.sku,
            "price_paise": product.price_paise,
            "merchant_id": session.merchant_id,
        },
        output={"category": product.category, "stock": product.stock},
        reasoning_summary=f"Merchant added product {product.sku} to the catalog.",
    )
    return product

# ---------------------------------------------------------------------------
# Merchant identity, onboarding, and per-merchant store API
# ---------------------------------------------------------------------------


class OnboardingRequest(BaseModel):
    store_name: str = Field(min_length=2, max_length=80)


class AgentKeyCreateRequest(BaseModel):
    label: str = Field(default="", max_length=120)
    buyer_agent_id: str = Field(default="", max_length=128)


def _agent_key_view(record: object) -> dict:
    return {
        "key_id": record.key_id,
        "label": record.label,
        "buyer_agent_id": record.buyer_agent_id,
        "key_prefix": record.key_prefix,
        "created_at": record.created_at.isoformat(),
        "revoked_at": record.revoked_at.isoformat() if record.revoked_at else None,
        "last_used_at": record.last_used_at.isoformat() if record.last_used_at else None,
    }


def _generate_agent_key_plaintext() -> str:
    return f"sellable_ak_{secrets.token_hex(24)}"


@app.get("/console/agent-keys", tags=["console"])
@limiter.limit("60/minute")
def console_agent_keys_list(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    """List this merchant's agent API keys (hashes/prefixes only, never plaintext)."""
    from sellable.repositories import AgentApiKeyRepository

    records = AgentApiKeyRepository().list_for_merchant(session.merchant_id)
    return {"keys": [_agent_key_view(r) for r in records]}


@app.post("/console/agent-keys", tags=["console"])
@limiter.limit("10/minute")
def console_agent_key_create(
    request: Request,
    body: AgentKeyCreateRequest,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    """Issue a new agent API key. The plaintext is returned exactly once."""
    require_owner(session)
    from sellable.repositories import AgentApiKeyRepository

    plaintext = _generate_agent_key_plaintext()
    record = AgentApiKeyRepository().create(
        key_id=f"ak_{secrets.token_hex(8)}",
        merchant_id=session.merchant_id,
        key_hash=hashlib.sha256(plaintext.encode("utf-8")).hexdigest(),
        key_prefix=plaintext[:20],
        label=body.label.strip(),
        buyer_agent_id=body.buyer_agent_id.strip(),
    )
    return {"plaintext": plaintext, "key": _agent_key_view(record)}


@app.post("/console/agent-keys/{key_id}/rotate", tags=["console"])
@limiter.limit("10/minute")
def console_agent_key_rotate(
    request: Request,
    key_id: str,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    """Revoke the given key and issue a replacement with the same scope.

    The new plaintext is returned exactly once; the old key stops working
    immediately.
    """
    require_owner(session)
    from sellable.repositories import AgentApiKeyRepository

    repo = AgentApiKeyRepository()
    existing = repo.get(key_id, session.merchant_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Agent key not found")
    if existing.revoked_at is not None:
        raise HTTPException(status_code=400, detail="This key is already revoked")
    revoked = repo.revoke(key_id, session.merchant_id)
    plaintext = _generate_agent_key_plaintext()
    record = repo.create(
        key_id=f"ak_{secrets.token_hex(8)}",
        merchant_id=session.merchant_id,
        key_hash=hashlib.sha256(plaintext.encode("utf-8")).hexdigest(),
        key_prefix=plaintext[:20],
        label=existing.label,
        buyer_agent_id=existing.buyer_agent_id,
    )
    return {
        "plaintext": plaintext,
        "key": _agent_key_view(record),
        "rotated_from": _agent_key_view(revoked),
    }


@app.delete("/console/agent-keys/{key_id}", tags=["console"])
@limiter.limit("30/minute")
def console_agent_key_revoke(
    request: Request,
    key_id: str,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    """Revoke an agent API key. Requests signed with it stop authenticating."""
    require_owner(session)
    from sellable.repositories import AgentApiKeyRepository

    record = AgentApiKeyRepository().revoke(key_id, session.merchant_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Agent key not found")
    return _agent_key_view(record)


@app.get("/console/store", tags=["console"])
@limiter.limit("60/minute")
def console_store(
    request: Request,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    """The authenticated merchant's own store record (real DB row)."""
    record = MerchantRepository().get(session.merchant_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Merchant record not found")
    return {
        "merchant_id": record.merchant_id,
        "name": record.name,
        "role": session.role,
        "created_at": record.created_at.isoformat(),
    }


@app.post("/console/onboarding", tags=["console"])
@limiter.limit("5/minute")
def console_onboarding(
    request: Request,
    body: OnboardingRequest,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict:
    """Create the authenticated user's own real merchant account.

    Requires a verified Supabase identity; creates exactly one merchant +
    membership + default policy. Never called automatically and never links
    the user to the demo store.
    """
    from sqlalchemy.orm import Session as _Session

    from sellable.ledger.database import MerchantUserRecord, make_engine

    # Already mapped? Onboarding is a one-time action.
    try:
        engine = make_engine()
        with _Session(engine) as db:
            existing = (
                db.query(MerchantUserRecord).filter_by(auth_user_id=user.auth_user_id).first()
            )
    except Exception as exc:
        logger.error("Onboarding membership check failed: %s", exc)
        raise HTTPException(status_code=500, detail="Database error during onboarding") from exc
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="This user already has a merchant account. Sign in again to refresh access.",
        )

    merchant_id, _policy = registry.create_merchant(name=body.store_name.strip())
    try:
        with _Session(engine) as db:
            db.add(
                MerchantUserRecord(
                    # Full auth user id: truncating to 8 chars risks a primary-key
                    # collision between two users sharing a prefix (500 on onboarding).
                    id=f"mu_{user.auth_user_id}",
                    merchant_id=merchant_id,
                    auth_user_id=user.auth_user_id,
                    role="owner",
                    created_at=datetime.now(timezone.utc),
                )
            )
            db.commit()
    except Exception as exc:
        logger.error("Onboarding membership write failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not link merchant membership") from exc
    record = MerchantRepository().get(merchant_id)
    return {
        "merchant_id": merchant_id,
        "name": record.name if record else body.store_name.strip(),
        "role": "owner",
        "created_at": record.created_at.isoformat() if record else None,
    }


@app.post(
    "/console/agent/buyer/run",
    response_model=BuyerResult,
    tags=["console"],
    deprecated=True,
)
@limiter.limit("10/minute")
def console_buyer_run(
    request: Request,
    mission: BuyerMission,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> BuyerResult:
    """Run the reference AI buyer against the authenticated merchant's own store.

    .. deprecated::
        Target architecture (``SELLABLE_ARCHITECTURE.md`` §7, §55) runs no
        Buyer Agent as a core component. Retained for demo/eval continuity
        during the revamp; frozen, no new features.

    The buyer agent operates on a gateway bound to the merchant's core, so
    discovery, quotes, and orders all resolve to the caller's catalog and
    policy — never the demo store.
    """
    core = merchant_core(session)
    gateway = AgentGateway(core, SellerAgent(core, llm=_seller_llm))
    buyer = BuyerAgent(gateway, llm=_make_llm()[0])
    result = buyer.run(mission, trace_id=resolve_trace_id(x_trace_id))
    return _with_mission_id(session.merchant_id, mission, result)


def _with_mission_id(
    merchant_id: str, mission: BuyerMission, result: BuyerResult
) -> BuyerResult:
    """Persist the run as a resumable mission and stamp the id on the result.

    Runs that never produced an order stay unpersisted (nothing to
    continue); a persistence failure never fails the buyer run itself.
    """
    try:
        mission_id = buyer_mission_service.record_run(
            merchant_id=merchant_id, mission=mission, result=result
        )
    except Exception as exc:  # noqa: BLE001 — mission persistence is additive
        logger.warning("Buyer mission persistence failed: %s", exc)
        return result
    if mission_id:
        result = result.model_copy(update={"mission_id": mission_id})
    return result


@app.get(
    "/console/buyer-missions",
    response_model=list[ConsoleBuyerMission],
    tags=["console"],
    summary="Recent resumable buyer missions for this merchant.",
)
@app.get("/buyer-missions", response_model=list[ConsoleBuyerMission], tags=["console"])
@limiter.limit("60/minute")
def console_buyer_missions(
    request: Request,
    limit: int = 20,
    commerce: CommerceCore = Depends(get_commerce),
    session: MerchantSession = Depends(get_merchant_session),
) -> list[ConsoleBuyerMission]:
    limit = max(1, min(limit, 100))
    return buyer_mission_service.list_snapshots(
        core=merchant_core(session),
        merchant_id=session.merchant_id,
        buyer_agent=merchant_buyer_agent(merchant_core(session)),
        limit=limit,
    )


@app.get(
    "/console/buyer-missions/{mission_id}",
    response_model=ConsoleBuyerMission,
    tags=["console"],
    summary="One buyer mission's authoritative, re-derived state.",
)
@limiter.limit("60/minute")
def console_buyer_mission_get(
    request: Request,
    mission_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    session: MerchantSession = Depends(get_merchant_session),
) -> ConsoleBuyerMission:
    core = merchant_core(session)
    try:
        return buyer_mission_service.snapshot(
            core=core,
            mission_id=mission_id,
            merchant_id=session.merchant_id,
            buyer_agent=merchant_buyer_agent(core),
        )
    except UnknownBuyerMissionError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post(
    "/console/buyer-missions/{mission_id}/continue",
    response_model=ConsoleBuyerMission,
    tags=["console"],
    summary=(
        "Resume the mission's SAME order: verify approval, reuse/issue "
        "consent, and start payment through the existing PaymentService."
    ),
)
@limiter.limit("30/minute")
def console_buyer_mission_continue(
    request: Request,
    mission_id: str,
    payments: PaymentService = Depends(get_payment_service),
    commerce: CommerceCore = Depends(get_commerce),
    session: MerchantSession = Depends(get_merchant_session),
) -> ConsoleBuyerMission:
    core = merchant_core(session)
    try:
        return buyer_mission_service.continue_mission(
            core=core,
            payments=payments,
            mission_id=mission_id,
            merchant_id=session.merchant_id,
            buyer_agent=merchant_buyer_agent(core),
        )
    except UnknownBuyerMissionError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RazorpayRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/console/catalog", response_model=list[Product], tags=["console"])
@limiter.limit("60/minute")
def console_catalog(
    request: Request,
    query: str = "",
    limit: int = 500,
    offset: int = 0,
    session: MerchantSession = Depends(get_merchant_session),
) -> list[Product]:
    """The authenticated merchant's real, DB-persisted catalog."""
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    products = CatalogRepository().list(session.merchant_id)
    if query:
        needle = query.strip().lower()
        products = [
            p
            for p in products
            if needle in p.sku.lower() or needle in p.title.lower() or needle in p.description.lower()
        ]
    return products[offset : offset + limit]


@app.get("/console/catalog/{sku}", response_model=Product, tags=["console"])
@limiter.limit("60/minute")
def console_catalog_item(
    request: Request,
    sku: str,
    session: MerchantSession = Depends(get_merchant_session),
) -> Product:
    for product in CatalogRepository().list(session.merchant_id):
        if product.sku == sku:
            return product
    raise HTTPException(status_code=404, detail=f"Unknown SKU: {sku}")


# ---------------------------------------------------------------------------
# Console commerce flow (merchant-authenticated chat checkout)
# ---------------------------------------------------------------------------


def _active_sku_from_trace(core: CommerceCore, trace_id: str) -> str | None:
    """Resolve the conversation's active product from the ledger.

    The last SKU actually quoted on this trace is the active product, so a
    typed follow-up ("can you do it for 1300?") applies to it without the
    frontend re-sending the SKU and without any LLM memory. Tenant-scoped:
    trace ids are client-influenced, so a colliding trace from another
    merchant must never resolve (or mis-resolve) this merchant's SKU.
    """
    for event in reversed(
        core.ledger.for_trace(trace_id, merchant_id=core.merchant_scope)
    ):
        if event.action in ("catalog.get", "quote.created", "negotiation.countered"):
            sku = (event.inputs_json or {}).get("sku")
            if isinstance(sku, str):
                return sku
    return None


def _copy_request_validated(body: SellerRequest, update: dict[str, object]) -> SellerRequest:
    """Apply an update to a seller request with contract validation.

    ``model_copy(update=...)`` skips validation, so a parsed or
    ledger-derived value (e.g. ``buyer_offer_paise=0``) could smuggle past
    the ``gt=0`` contract. Re-validate and fail closed to the original
    request (normal product discovery) instead of erroring the turn.
    """
    try:
        return SellerRequest.model_validate({**body.model_dump(), **update})
    except ValidationError:
        logger.warning(
            "negotiation-aware request update failed validation; using original request"
        )
        return body


def _negotiation_aware_request(
    core: CommerceCore, body: SellerRequest, trace_id: str
) -> SellerRequest:
    """Classify a human-typed turn and route it to the right deterministic flow.

    Machine callers send structured fields (sku / buyer_offer_paise) and are
    taken as-is. For typed messages, negotiation and price queries are
    detected deterministically (never by the LLM) and applied to the active
    product resolved from the ledger, so "can you do it for 1300?" negotiates
    the currently quoted SKU instead of restarting product discovery.
    """
    parsed = classify_buyer_message(body.message)
    # An explicit structured offer is always a negotiation turn; upsells are
    # disabled while the primary price is contested.
    if body.buyer_offer_paise is not None:
        if body.request_upsell:
            return _copy_request_validated(body, {"request_upsell": False})
        return body
    if body.price_query or body.accept_upsell:
        return body
    if parsed.kind is TurnKind.NEGOTIATE_OFFER or parsed.kind is TurnKind.PRICE_QUERY:
        active_sku = body.requested_sku or _active_sku_from_trace(core, trace_id)
        if active_sku is None:
            return body  # nothing quoted yet — normal product discovery
        update: dict[str, object] = {
            "requested_sku": active_sku,
            "request_upsell": False,  # no accessories while negotiating
        }
        if parsed.kind is TurnKind.NEGOTIATE_OFFER:
            # Belt-and-braces with parse_offer_paise's own clamp: the offer
            # reaching the validated copy must satisfy buyer_offer_paise gt=0.
            update["buyer_offer_paise"] = max(1, parsed.offer_paise or 0)
        else:
            update["price_query"] = True
        return _copy_request_validated(body, update)
    if parsed.kind is TurnKind.ACCEPT_UPSELL:
        offered = any(
            event.action == "upsell.offered"
            for event in core.ledger.for_trace(trace_id, merchant_id=core.merchant_scope)
        )
        if offered:
            active_sku = body.requested_sku or _active_sku_from_trace(core, trace_id)
            update: dict[str, object] = {"accept_upsell": True, "request_upsell": True}
            if active_sku:
                update["requested_sku"] = active_sku
            return _copy_request_validated(body, update)
    return body


@app.post("/console/agent/seller/respond", response_model=SellerDecision, tags=["console"])
@limiter.limit("30/minute")
def console_seller_respond(
    request: Request,
    body: SellerRequest,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> SellerDecision:
    """Conversational checkout against the merchant's own catalog and policy.

    Typed negotiation ("can you do 1300?") is detected deterministically and
    routed through the policy engine against the active product; the LLM only
    phrases the grounded result.
    """
    core = merchant_core(session)
    trace_id = resolve_trace_id(x_trace_id)
    body = _negotiation_aware_request(core, body, trace_id)
    agent = SellerAgent(core, llm=_seller_llm)
    return agent.respond(body, trace_id=trace_id)


@app.post("/console/agent/service/respond", response_model=CSDecision, tags=["console"])
@limiter.limit("30/minute")
def console_service_respond(
    request: Request,
    body: CSRequest,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> CSDecision:
    """Support chat against the merchant's own orders and policies.

    Runs the Customer Service Agent on the caller's core: authenticated
    order help, shipping status, returns, exchanges, bounded refund asks,
    and human escalation — never direct refunds or policy overrides.
    """
    core = merchant_core(session)
    trace_id = resolve_trace_id(x_trace_id)
    agent = CustomerServiceAgent(core, llm=_seller_llm)
    return agent.respond(body, trace_id=trace_id)


@app.post("/console/orders", tags=["console"])
@limiter.limit("30/minute")
def console_order_create(
    request: Request,
    body: OrderCreateRequest,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> dict:
    core = merchant_core(session)
    # One stable trace per client flow; fast-path replay only when the
    # caller repeats the same trace (see /agent/orders.create).
    trace_id = resolve_trace_id(x_trace_id, body_trace_id=body.trace_id)
    pre_existing = core.get_order_by_idempotency_key(body.idempotency_key)
    if pre_existing is not None and pre_existing.trace_id == trace_id:
        return {
            "order_id": pre_existing.order_id,
            "trace_id": pre_existing.trace_id,
            "status": pre_existing.status,
            "amount_paise": pre_existing.amount_paise,
            "quote_id": pre_existing.quote_id,
            "idempotency_key": pre_existing.idempotency_key,
            "replayed": True,
        }

    decision = SellerAgent(core, llm=_seller_llm).respond(
        SellerRequest(
            message=body.message,
            intent=body.intent,
            requested_sku=body.requested_sku,
            quantity=body.quantity,
            buyer_offer_paise=body.buyer_offer_paise,
            request_upsell=body.request_upsell,
        ),
        trace_id=trace_id,
    )
    if (
        decision.cart is None
        or decision.policy_decision is None
        or decision.policy_decision.verdict is PolicyVerdict.DENY
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Order creation blocked by policy: "
                f"{decision.policy_decision.reason_code if decision.policy_decision else 'NO_MATCH'}"
            ),
        )
    try:
        order = core.create_order(
            cart=decision.cart,
            intent=body.intent,
            trace_id=trace_id,
            idempotency_key=body.idempotency_key,
        )
    except IdempotencyReuseError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        # Policy denial or a lost create_order race — never a 500.
        raise HTTPException(status_code=409, detail=str(error)) from error
    if pre_existing is not None and pre_existing.order_id == order.order_id:
        return {
            "order_id": order.order_id,
            "trace_id": order.trace_id,
            "status": order.status,
            "amount_paise": order.amount_paise,
            "quote_id": order.quote_id,
            "idempotency_key": order.idempotency_key,
            "replayed": True,
        }
    return {
        "order_id": order.order_id,
        "trace_id": order.trace_id,
        "status": order.status,
        "amount_paise": order.amount_paise,
        "quote_id": order.quote_id,
        "idempotency_key": order.idempotency_key,
        "requires_approval": order.requires_approval,
    }


@app.post("/console/orders/{order_id}/consent", tags=["console"])
@limiter.limit("30/minute")
def console_consent_request(
    request: Request,
    order_id: str,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    core = merchant_core(session)
    try:
        consent = core.issue_consent(order_id)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {
        "consent_id": consent.consent_id,
        "order_id": consent.order_id,
        "amount_paise": consent.amount_paise,
        "payee_id": consent.payee_id,
        "purpose": consent.purpose,
        "expires_at": consent.expires_at.isoformat(),
        "single_use": consent.single_use,
        "status": consent.status,
    }


@app.post(
    "/console/orders/{order_id}/payment",
    response_model=PaymentAttempt,
    tags=["console"],
    summary="Start a Razorpay test-mode payment for the merchant's own order.",
)
@limiter.limit("10/minute")
def console_start_payment(
    request: Request,
    order_id: str,
    body: PaymentStartRequest,
    payments: PaymentService = Depends(get_payment_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> PaymentAttempt:
    core = merchant_core(session)
    try:
        return payments.start_payment(
            order_id=order_id, consent_id=body.consent_id, commerce=core
        )
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RazorpayRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post(
    "/console/orders/{order_id}/payment/retry",
    response_model=PaymentAttempt,
    tags=["console"],
    summary="Bounded, idempotent retry for the merchant's own failed payment.",
)
@limiter.limit("10/minute")
def console_retry_payment(
    request: Request,
    order_id: str,
    payments: PaymentService = Depends(get_payment_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> PaymentAttempt:
    core = merchant_core(session)
    try:
        return payments.retry_payment(order_id=order_id, commerce=core)
    except RazorpayConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RazorpayRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


# ---------------------------------------------------------------------------
# Durable checkout sessions (chat continuity across reload/navigation)
#
# The session row is a pointer, never a second state machine: money state
# comes from the linked order, approval state from the order, policy from
# the policy row. The row persists the transcript, the last backend-issued
# quote snapshot, the applied budget, and the active order link.
# ---------------------------------------------------------------------------


def get_checkout_repo() -> CheckoutSessionRepository:
    return CheckoutSessionRepository()


def get_order_repo() -> OrderRepository:
    return OrderRepository()


@app.get("/console/checkout/session", response_model=CheckoutSession, tags=["console"])
@limiter.limit("30/minute")
def console_checkout_session_get(
    request: Request,
    buyer_ref: str = "human_chat",
    session: MerchantSession = Depends(get_merchant_session),
    repo: CheckoutSessionRepository = Depends(get_checkout_repo),
) -> CheckoutSession:
    """Return the merchant's active checkout session, if one exists.

    A missing session is a 404 the console treats as a fresh start — never
    an error, and refresh must not create a session implicitly.
    """
    found = repo.active_for(session.merchant_id, buyer_ref)
    if found is None:
        raise HTTPException(status_code=404, detail="no_active_session")
    return found


def _reject_oversized_blob(name: str, blob: dict[str, object] | None, limit_bytes: int) -> None:
    """Fail closed (413) when a client snapshot blob exceeds its persist cap."""
    if blob is None:
        return
    size = len(json.dumps(blob, separators=(",", ":")).encode("utf-8"))
    if size > limit_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Checkout session {name} snapshot exceeds {limit_bytes} bytes",
        )


@app.post("/console/checkout/session", response_model=CheckoutSession, tags=["console"])
@limiter.limit("30/minute")
def console_checkout_session_save(
    request: Request,
    body: CheckoutSessionUpsert,
    session: MerchantSession = Depends(get_merchant_session),
    repo: CheckoutSessionRepository = Depends(get_checkout_repo),
) -> CheckoutSession:
    """Create or update the merchant's checkout session snapshot.

    Without a session_id this upserts the single ACTIVE row (creating it on
    the first user action — never on plain page loads). With a session_id it
    updates that row after an ownership check; closed sessions reject writes.
    Linking an order advances the lifecycle to ORDER_PLACED.

    Quote/decision snapshots are size-capped (413 past the cap): checkout
    always re-quotes server-side, so an oversized client blob is never
    needed and must not bloat the shared sessions table.
    """
    _reject_oversized_blob("cart", body.cart, CheckoutSessionRepository.MAX_CART_JSON_BYTES)
    _reject_oversized_blob(
        "decision", body.decision, CheckoutSessionRepository.MAX_DECISION_JSON_BYTES
    )
    now = datetime.now(timezone.utc)
    if body.session_id:
        existing = repo.get(body.session_id)
        if existing is None or existing.merchant_id != session.merchant_id:
            raise HTTPException(status_code=404, detail="Checkout session not found")
        if existing.status in (
            CheckoutSessionStatus.COMPLETED,
            CheckoutSessionStatus.ABANDONED,
        ):
            raise HTTPException(status_code=409, detail="Checkout session is closed")
        patch = body.model_dump(exclude_none=True)
        patch.pop("session_id", None)
        # model_validate (not model_copy): nested message dicts must be
        # re-coerced into ChatMessage models.
        data = CheckoutSession.model_validate(
            {**existing.model_dump(), **patch, "updated_at": now}
        )
    else:
        base = repo.active_for(session.merchant_id, body.buyer_ref) or CheckoutSession(
            merchant_id=session.merchant_id,
            buyer_ref=body.buyer_ref,
            created_at=now,
        )
        patch = body.model_dump(exclude_none=True)
        patch.pop("session_id", None)
        patch.pop("buyer_ref", None)
        data = CheckoutSession.model_validate(
            {**base.model_dump(), **patch, "updated_at": now}
        )
    if data.order_id and data.status is CheckoutSessionStatus.ACTIVE:
        data = data.model_copy(update={"status": CheckoutSessionStatus.ORDER_PLACED})
    return repo.save(data)


@app.post(
    "/console/checkout/session/{session_id}/close", response_model=CheckoutSession, tags=["console"]
)
@limiter.limit("30/minute")
def console_checkout_session_close(
    request: Request,
    session_id: str,
    session: MerchantSession = Depends(get_merchant_session),
    repo: CheckoutSessionRepository = Depends(get_checkout_repo),
) -> CheckoutSession:
    """Abandon a checkout session (the NEW SESSION action)."""
    closed = repo.close(session_id, session.merchant_id)
    if closed is None:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    return closed


@app.get("/console/checkout/sessions", response_model=list[CheckoutSessionListItem], tags=["console"])
@limiter.limit("30/minute")
def console_checkout_sessions_list(
    request: Request,
    buyer_ref: str = "human_chat",
    include_archived: bool = False,
    limit: int = 50,
    offset: int = 0,
    session: MerchantSession = Depends(get_merchant_session),
    repo: CheckoutSessionRepository = Depends(get_checkout_repo),
    orders: OrderRepository = Depends(get_order_repo),
) -> list[CheckoutSessionListItem]:
    """Newest-first lightweight chat history for this merchant+buyer.

    Items carry metadata only (no transcript/cart/decision blobs). Linked
    orders are enriched in ONE batched lookup — never one query per session.
    Read-only: listing never creates or mutates a session.
    """
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    items = repo.list_sessions(
        session.merchant_id,
        buyer_ref,
        include_archived=include_archived,
        limit=limit,
        offset=offset,
    )
    linked = orders.get_many(
        [item.order_id for item in items if item.order_id],
        merchant_id=session.merchant_id,
    )
    enriched: list[CheckoutSessionListItem] = []
    for item in items:
        order = linked.get(item.order_id) if item.order_id else None
        if order is None:
            enriched.append(item)
            continue
        enriched.append(
            item.model_copy(
                update={
                    "order_status": order.status,
                    "amount_paise": order.amount_paise,
                    # Display hint: the linked order is held for a human.
                    "approval_pending": bool(
                        order.requires_approval
                        and order.status is OrderStatus.AWAITING_CONSENT
                    ),
                }
            )
        )
    return enriched


@app.get("/console/checkout/session/{session_id}", response_model=CheckoutSession, tags=["console"])
@limiter.limit("30/minute")
def console_checkout_session_open(
    request: Request,
    session_id: str,
    session: MerchantSession = Depends(get_merchant_session),
    repo: CheckoutSessionRepository = Depends(get_checkout_repo),
) -> CheckoutSession:
    """Open one full session by id. Unknown ids AND other merchants' rows
    are both 404 (no cross-tenant existence oracle). Read-only: opening
    never creates or mutates a session."""
    found = repo.get(session_id)
    if found is None or found.merchant_id != session.merchant_id:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    return found


@app.patch("/console/checkout/session/{session_id}", response_model=CheckoutSession, tags=["console"])
@limiter.limit("30/minute")
def console_checkout_session_patch(
    request: Request,
    session_id: str,
    body: CheckoutSessionPatch,
    session: MerchantSession = Depends(get_merchant_session),
    repo: CheckoutSessionRepository = Depends(get_checkout_repo),
) -> CheckoutSession:
    """Ownership-checked partial update: rename (title) and/or (un)archive.

    An explicit title — including an empty one, which clears the label back
    to NULL — is stored exactly as given and never re-derived. Unarchiving
    (``archived=false``) restores the row to the default history list.
    """
    existing = repo.get(session_id)
    if existing is None or existing.merchant_id != session.merchant_id:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    updates: dict[str, object] = {"updated_at": datetime.now(timezone.utc)}
    if body.title is not None:
        # Overlong titles never reach here: CheckoutSessionPatch caps at 160
        # and FastAPI answers 422. A blank title clears the label to NULL.
        updates["title"] = body.title.strip() or None
    if body.archived is not None:
        updates["archived"] = body.archived
    if len(updates) == 1:
        raise HTTPException(status_code=400, detail="No fields to update")
    return repo.save(existing.model_copy(update=updates), derive_title=False)


@app.delete("/console/checkout/session/{session_id}", response_model=CheckoutSession, tags=["console"])
@limiter.limit("30/minute")
def console_checkout_session_delete(
    request: Request,
    session_id: str,
    session: MerchantSession = Depends(get_merchant_session),
    repo: CheckoutSessionRepository = Depends(get_checkout_repo),
) -> CheckoutSession:
    """Archive a history row (abandoning it first if still ACTIVE).

    Soft-delete only: the row stays in the database and linked commerce
    records (orders, ledger events, refunds, consents) are never touched.
    """
    removed = repo.delete(session_id, session.merchant_id)
    if removed is None:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    return removed
