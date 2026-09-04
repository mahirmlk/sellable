"""Phase 0 application entrypoint."""

from __future__ import annotations

import logging
import re
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse, StreamingResponse

from sellable.agents.buyer import BuyerAgent, BuyerResult
from sellable.agents.seller import SellerAgent, SellerDecision, SellerRequest
from sellable.auth import AgentApiKey, get_agent_api_key, get_agent_api_key_signed
from sellable.config import settings
from sellable.contracts import (
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
    ConsoleGrowthMetrics,
    ConsolePolicySettings,
    ConsolePolicyUpdate,
    ConsoleTransactionDetail,
    ConsoleTransactionItem,
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
from sellable.gateway import AgentGateway
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
    MerchantRepository,
    OrderRepository,
)
from sellable.status import build_status

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("sellable")

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Starting SELLABLE Commerce Core")
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
    allow_headers=["Authorization", "Content-Type", "X-Agent-Key", "Accept", "X-Agent-Id", "X-Timestamp", "X-Nonce", "X-Signature"],
    max_age=600,
)

app.add_middleware(RequestBodyCaptureMiddleware)

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


_seller_llm, _llm_init_error = _make_llm()

# Create tables and the real demo-merchant records before wiring components.
initialise_database()
registry = MerchantRegistry()
registry.ensure_demo_merchant()
commerce_core = registry.get(DEMO_MERCHANT_ID)
seller_agent = SellerAgent(commerce_core, llm=_seller_llm)
agent_gateway = AgentGateway(commerce_core, seller_agent)
buyer_agent = BuyerAgent(agent_gateway, llm=_make_llm()[0])
payment_service = PaymentService(commerce_core, RazorpayAdapter(settings), core_resolver=registry.get)
refund_service = RefundService(commerce_core, RazorpayAdapter(settings))


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


def get_seller_agent() -> SellerAgent:
    return seller_agent


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
    return {
        "status": "ok",
        "environment": settings.environment,
        "database": "connected",
        "razorpay_configured": settings.razorpay_is_configured,
        "cors_origins": list(settings.cors_origins),
    }


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
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
) -> SellerDecision:
    return gateway.create_quote(body, trace_id=resolve_trace_id(x_trace_id))


@app.post("/agent/quotes.negotiate", response_model=SellerDecision, tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_quote_negotiate(
    request: Request,
    body: SellerRequest,
    gateway: AgentGateway = Depends(get_agent_gateway),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
    x_trace_id: str | None = Header(default=None),
) -> SellerDecision:
    return gateway.create_quote(body, trace_id=resolve_trace_id(x_trace_id))


@app.post("/agent/buyer/run", response_model=BuyerResult, tags=["buyer-agent"])
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
    return agent.run(mission, trace_id=resolve_trace_id(x_trace_id))


@app.post("/agent/consents.request", tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_consents_request(
    request: Request,
    body: ConsentRequest,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key_signed),
) -> dict:
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
) -> dict:
    from agents.seller.agent import SellerRequest

    # One stable trace per client flow (X-Trace-Id header > body trace_id).
    # Fast-path replay only when the caller repeats the same trace: the same
    # key with a different cart/message must go through the core guard below,
    # which raises IdempotencyReuseError instead of returning another
    # transaction's order.
    trace_id = resolve_trace_id(x_trace_id, body_trace_id=body.trace_id)
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
        return payments.handle_webhook(body, x_razorpay_signature)
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


@app.post(
    "/orders/{order_id}/refund",
    tags=["payments"],
    summary="Issue a refund for a paid order.",
)
@limiter.limit("10/minute")
def refund_order(
    request: Request,
    order_id: str,
    reason: str = "merchant_initiated",
    amount_paise: int | None = None,
    idempotency_key: str | None = None,
    refunds: RefundService = Depends(get_refund_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    if len(reason) > 500:
        raise HTTPException(status_code=400, detail="Reason must be 500 characters or fewer")
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
) -> dict[str, object]:
    """Derive merchant-facing policy/consent/payment/item facts from the ledger.

    The frontend never computes these states; it renders the backend's
    authoritative summary, which is reconstructed from the XAI Ledger (§9).
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

    if consent_used:
        consent_status = "CONSUMED"
    elif consent_issued:
        consent_status = "ISSUED"
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
) -> dict[str, object]:
    events = ledger.for_trace(getattr(order, "trace_id"), merchant_id=merchant_id)
    return _summarize_order(order, list(events))


@app.get("/console/transactions", response_model=list[ConsoleTransactionItem], tags=["console"])
@app.get("/transactions", response_model=list[ConsoleTransactionItem], tags=["console"])
@limiter.limit("60/minute")
def console_transactions(
    request: Request,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> list[ConsoleTransactionItem]:
    core = merchant_core(session)
    orders = core.all_orders()
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
                {**base.model_dump(), **_summarize_order(o, batched.get(o.trace_id, []))}
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
    enriched = _enrich_transaction(order, ledger, session.merchant_id)
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
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> list[ConsoleApprovalRequest]:
    from sellable.contracts import OrderStatus

    core = merchant_core(session)
    orders = core.all_orders()
    held = [
        order
        for order in orders
        if order.requires_approval
        and order.status in (OrderStatus.AWAITING_CONSENT,)
    ]
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
        return {"status": "approved", "order_id": order_id, "consent_id": consent.consent_id}
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
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
) -> ConsoleGrowthMetrics:
    from sellable.contracts import OrderStatus

    core = merchant_core(session)
    orders = core.all_orders()
    paid = [o for o in orders if o.status == OrderStatus.PAID]
    revenue = sum(o.amount_paise for o in paid)

    events = ledger.all_events(limit=1000, merchant_id=session.merchant_id)

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


@app.post("/console/agent/buyer/run", response_model=BuyerResult, tags=["console"])
@limiter.limit("10/minute")
def console_buyer_run(
    request: Request,
    mission: BuyerMission,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> BuyerResult:
    """Run the reference AI buyer against the authenticated merchant's own store.

    The buyer agent operates on a gateway bound to the merchant's core, so
    discovery, quotes, and orders all resolve to the caller's catalog and
    policy — never the demo store.
    """
    core = merchant_core(session)
    gateway = AgentGateway(core, SellerAgent(core, llm=_seller_llm))
    buyer = BuyerAgent(gateway, llm=_make_llm()[0])
    return buyer.run(mission, trace_id=resolve_trace_id(x_trace_id))


@app.get("/console/catalog", response_model=list[Product], tags=["console"])
@limiter.limit("60/minute")
def console_catalog(
    request: Request,
    query: str = "",
    session: MerchantSession = Depends(get_merchant_session),
) -> list[Product]:
    """The authenticated merchant's real, DB-persisted catalog."""
    products = CatalogRepository().list(session.merchant_id)
    if query:
        needle = query.strip().lower()
        products = [
            p
            for p in products
            if needle in p.sku.lower() or needle in p.title.lower() or needle in p.description.lower()
        ]
    return products


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


@app.post("/console/agent/seller/respond", response_model=SellerDecision, tags=["console"])
@limiter.limit("30/minute")
def console_seller_respond(
    request: Request,
    body: SellerRequest,
    session: MerchantSession = Depends(get_merchant_session),
    x_trace_id: str | None = Header(default=None),
) -> SellerDecision:
    """Conversational checkout against the merchant's own catalog and policy."""
    core = merchant_core(session)
    agent = SellerAgent(core, llm=_seller_llm)
    return agent.respond(body, trace_id=resolve_trace_id(x_trace_id))


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
    """
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
