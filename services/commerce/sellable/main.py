"""Phase 0 application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse, StreamingResponse

from sellable.agents.buyer import BuyerAgent, BuyerResult
from sellable.agents.seller import SellerAgent, SellerDecision, SellerRequest
from sellable.auth import AgentApiKey, get_agent_api_key
from sellable.config import settings
from sellable.contracts import (
    BuyerMission,
    CatalogGetRequest,
    CatalogSearchRequest,
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
from sellable.core import CommerceCore
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
    UnknownProviderOrderError,
    UnsupportedWebhookEventError,
)
from sellable.refunds import RefundService
from sellable.registry import (
    DEMO_MERCHANT_ID,
    MerchantRegistry,
    save_policy_for,
)
from sellable.repositories import CatalogRepository, MerchantRepository
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


def _merchant_trace_ids(core: CommerceCore) -> set[str]:
    """Trace ids that belong to this merchant (orders + per-merchant system traces)."""
    traces = {o.trace_id for o in core.all_orders()}
    traces.add(f"policy_update:{core.policy.merchant_id}")
    traces.add(f"catalog_update:{core.policy.merchant_id}")
    if core.policy.merchant_id == DEMO_MERCHANT_ID:
        # Legacy system traces recorded before per-merchant scoping.
        traces.update({"policy_update", "catalog_update"})
    return traces


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
payment_service = PaymentService(commerce_core, RazorpayAdapter(settings))
refund_service = RefundService(commerce_core)


def merchant_core(session: MerchantSession) -> CommerceCore:
    """Return the caller's own merchant core (scoped catalog, policy, orders)."""
    return registry.get(session.merchant_id)


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
) -> SellerDecision:
    """Never creates an order, issues consent, or executes a payment."""
    return agent.respond(body)


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
) -> SellerDecision:
    return gateway.create_quote(body)


@app.post("/agent/quotes.negotiate", response_model=SellerDecision, tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_quote_negotiate(
    request: Request,
    body: SellerRequest,
    gateway: AgentGateway = Depends(get_agent_gateway),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> SellerDecision:
    return gateway.create_quote(body)


@app.post("/agent/buyer/run", response_model=BuyerResult, tags=["buyer-agent"])
@limiter.limit("10/minute")
def buyer_run(
    request: Request,
    mission: BuyerMission,
    agent: BuyerAgent = Depends(get_buyer_agent),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> BuyerResult:
    return agent.run(mission)


@app.post("/agent/consents.request", tags=["agent-gateway"])
@limiter.limit("30/minute")
def agent_consents_request(
    request: Request,
    body: ConsentRequest,
    commerce: CommerceCore = Depends(get_commerce),
    _api_key: AgentApiKey = Depends(get_agent_api_key),
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
    _api_key: AgentApiKey = Depends(get_agent_api_key),
) -> dict:
    from uuid import uuid4

    from agents.seller.agent import SellerRequest

    existing_order = commerce.get_order_by_idempotency_key(body.idempotency_key)
    if existing_order is not None:
        return {
            "order_id": existing_order.order_id,
            "trace_id": existing_order.trace_id,
            "status": existing_order.status,
            "amount_paise": existing_order.amount_paise,
            "quote_id": existing_order.quote_id,
            "idempotency_key": existing_order.idempotency_key,
            "replayed": True,
        }

    trace_id = body.trace_id or f"trc_{uuid4().hex}"
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
    order = commerce.create_order(
        cart=decision.cart,
        intent=body.intent,
        trace_id=trace_id,
        idempotency_key=body.idempotency_key,
    )
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
        "payment_id": None,
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
    core = merchant_core(session)
    try:
        return refunds.initiate_refund(
            order_id=body.order_id, reason=body.reason, commerce=core
        )
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
    _api_key: AgentApiKey = Depends(get_agent_api_key),
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
    _api_key: AgentApiKey = Depends(get_agent_api_key),
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
@limiter.exempt
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
    refunds: RefundService = Depends(get_refund_service),
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    if len(reason) > 500:
        raise HTTPException(status_code=400, detail="Reason must be 500 characters or fewer")
    core = merchant_core(session)
    try:
        # A merchant-scoped core only knows its own orders, so foreign
        # order ids fail with a 404-equivalent ownership error.
        return refunds.initiate_refund(order_id=order_id, reason=reason, commerce=core)
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


def _simulate_provider_event(payments: PaymentService, order_id: str, event: str) -> PaymentAttempt:
    from uuid import uuid4

    if settings.environment == "production":
        raise HTTPException(status_code=403, detail="Webhook simulation is disabled in production")
    attempt = payments._attempt_by_order_id.get(order_id)
    if attempt is None:
        raise HTTPException(status_code=409, detail="No payment attempt exists for this order")
    order = commerce_core.get_order(order_id)
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
        return payments.handle_webhook(body, signature)
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> PaymentAttempt:
    return _simulate_provider_event(payments, order_id, "payment.captured")


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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> PaymentAttempt:
    return _simulate_provider_event(payments, order_id, "payment.failed")


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
    elif status in ("AWAITING_CONSENT", "QUOTED"):
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
) -> dict[str, object]:
    events = ledger.for_trace(getattr(order, "trace_id"))
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
    enriched: list[ConsoleTransactionItem] = []
    for o in sorted(orders, key=lambda x: x.created_at, reverse=True):
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
        )
        enriched.append(ConsoleTransactionItem.model_validate({**base.model_dump(), **_enrich_transaction(o, ledger)}))
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
    events = ledger.for_trace(order.trace_id)
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
    )
    enriched = _enrich_transaction(order, ledger)
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


@app.get("/activity/stream", tags=["console"])
@limiter.limit("30/minute")
async def activity_stream(
    request: Request,
    ledger: LedgerRepository = Depends(get_ledger),
    session: MerchantSession = Depends(get_merchant_session),
):
    """Server-Sent Events stream of new ledger activity (§46), scoped to the merchant."""
    import asyncio
    import json

    core = merchant_core(session)
    merchant_traces = _merchant_trace_ids(core)

    async def event_generator():
        last_sequence = ledger.max_sequence()
        while True:
            if await request.is_disconnected():
                break
            try:
                events = ledger.events_after(last_sequence, limit=100, trace_ids=merchant_traces)
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
            except Exception:
                yield ": keep-alive\n\n"
            await asyncio.sleep(1)

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
    core = merchant_core(session)
    merchant_traces = _merchant_trace_ids(core)
    events = ledger.all_events(limit=limit, offset=offset, trace_ids=merchant_traces)
    total = ledger.count_events(trace_ids=merchant_traces)
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
    approvals: list[ConsoleApprovalRequest] = []
    for order in orders:
        if order.requires_approval and order.status in (
            OrderStatus.AWAITING_CONSENT,
            OrderStatus.QUOTED,
        ):
            events = ledger.for_trace(order.trace_id)
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
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    core = merchant_core(session)
    try:
        core.mark_aborted(order_id, reason="Order rejected by merchant via console.")
        return {"status": "rejected", "order_id": order_id}
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

    events = ledger.all_events(limit=1000, trace_ids=_merchant_trace_ids(core))
    upsell_offers = sum(1 for e in events if e.action == "upsell.suggest")
    upsell_accepted = sum(
        1 for e in events if e.action == "upsell.suggest" and e.output_json.get("accepted")
    )
    negotiations = sum(1 for e in events if "negotiat" in e.action)
    negotiated_accepted = sum(
        1 for e in events if "negotiat" in e.action and e.output_json.get("accepted")
    )

    avg_order = revenue // len(paid) if paid else 0
    upsell_rev = sum(
        o.amount_paise
        for o in paid
        if any(e.action == "upsell.suggest" and e.output_json.get("accepted") for e in events if e.trace_id == o.trace_id)
    )

    return ConsoleGrowthMetrics(
        revenue=revenue,
        agent_assisted_revenue=revenue,
        upsell_revenue=upsell_rev,
        avg_order_value=avg_order,
        total_orders=len(orders),
        upsell_offers=upsell_offers,
        upsell_accepted=upsell_accepted,
        negotiations=negotiations,
        negotiated_accepted=negotiated_accepted,
        countered=negotiations - negotiated_accepted,
        walked_away=0,
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
    events = ledger.for_trace(order.trace_id)
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
) -> dict:
    """Report real, backend-driven component state (never hardcoded green)."""
    core = merchant_core(session)
    return build_status(
        commerce=core,
        ledger=ledger,
        seller_agent=seller_agent,
        buyer_agent=buyer_agent,
        gateway=gateway,
        llm_adapter=_seller_llm,
        llm_init_error=_llm_init_error,
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
                    id=f"mu_{user.auth_user_id[:8]}",
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
) -> SellerDecision:
    """Conversational checkout against the merchant's own catalog and policy."""
    core = merchant_core(session)
    agent = SellerAgent(core, llm=_seller_llm)
    return agent.respond(body)


@app.post("/console/orders", tags=["console"])
@limiter.limit("30/minute")
def console_order_create(
    request: Request,
    body: OrderCreateRequest,
    session: MerchantSession = Depends(get_merchant_session),
) -> dict:
    from uuid import uuid4

    core = merchant_core(session)
    existing_order = core.get_order_by_idempotency_key(body.idempotency_key)
    if existing_order is not None:
        return {
            "order_id": existing_order.order_id,
            "trace_id": existing_order.trace_id,
            "status": existing_order.status,
            "amount_paise": existing_order.amount_paise,
            "quote_id": existing_order.quote_id,
            "idempotency_key": existing_order.idempotency_key,
            "replayed": True,
        }

    trace_id = body.trace_id or f"trc_{uuid4().hex}"
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
    order = core.create_order(
        cart=decision.cart,
        intent=body.intent,
        trace_id=trace_id,
        idempotency_key=body.idempotency_key,
    )
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
