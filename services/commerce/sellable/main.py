"""Phase 0 application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select
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
from sellable.merchant_auth import MerchantSession, get_merchant_session
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
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestBodyCaptureMiddleware)

app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded,
    lambda _, exc: JSONResponse(status_code=429, content={"detail": f"Rate limit exceeded: {exc.detail}"}),
)


def _save_policy_to_db(policy: MerchantPolicy) -> None:
    """Persist merchant policy to database."""
    from sqlalchemy.orm import Session
    from sellable.ledger.database import PolicyRecord, make_engine

    engine = make_engine()
    with Session(engine) as session:
        existing = session.get(PolicyRecord, policy.merchant_id)
        if existing:
            existing.policy_json = policy.model_dump()
        else:
            record = PolicyRecord(
                merchant_id=policy.merchant_id,
                policy_json=policy.model_dump(),
            )
            session.add(record)
        session.commit()


def _load_policy_from_db() -> MerchantPolicy | None:
    """Load merchant policy from database if it exists."""
    from sqlalchemy.orm import Session
    from sellable.ledger.database import PolicyRecord, make_engine

    try:
        engine = make_engine()
        with Session(engine) as session:
            record = session.scalars(select(PolicyRecord)).first()
            if record:
                policy = MerchantPolicy.model_validate(record.policy_json)
                logger.info("Loaded policy from database: threshold=%d", policy.human_approval_threshold_paise)
                return policy
    except Exception as exc:
        logger.warning("Could not load policy from database: %s", exc)
    return None


# Initialize database before creating commerce core
initialise_database()

# Load policy from DB if saved, otherwise use seed
_db_policy = _load_policy_from_db()
commerce_core = CommerceCore.from_seed(LedgerRepository(), policy_override=_db_policy)


def _make_llm():
    """Return a real LLM adapter when a non-mock provider is configured."""
    from agents.llm import get_llm

    if settings.llm_provider in ("mock", "deterministic", ""):
        return None
    if not settings.llm_is_configured:
        return None
    try:
        return get_llm()
    except Exception:
        return None


_seller_llm = _make_llm()
seller_agent = SellerAgent(commerce_core, llm=_seller_llm)
agent_gateway = AgentGateway(commerce_core, seller_agent)
buyer_agent = BuyerAgent(agent_gateway, llm=_make_llm())
payment_service = PaymentService(commerce_core, RazorpayAdapter(settings))
refund_service = RefundService(commerce_core)


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
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "environment": settings.environment,
        "database": "connected",
        "razorpay_configured": settings.razorpay_is_configured,
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> dict:
    try:
        return refunds.initiate_refund(order_id=body.order_id, reason=body.reason)
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> dict:
    if len(reason) > 500:
        raise HTTPException(status_code=400, detail="Reason must be 500 characters or fewer")
    try:
        return refunds.initiate_refund(order_id=order_id, reason=reason)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# ---------------------------------------------------------------------------
# Console API endpoints (merchant dashboard)
# ---------------------------------------------------------------------------


@app.get("/console/transactions", response_model=list[ConsoleTransactionItem], tags=["console"])
@app.get("/transactions", response_model=list[ConsoleTransactionItem], tags=["console"])
@limiter.limit("60/minute")
def console_transactions(
    request: Request,
    commerce: CommerceCore = Depends(get_commerce),
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> list[ConsoleTransactionItem]:
    orders = commerce.all_orders()
    return [
        ConsoleTransactionItem(
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
        for o in sorted(orders, key=lambda x: x.created_at, reverse=True)
    ]


@app.get("/console/transactions/{order_id}", response_model=ConsoleTransactionDetail, tags=["console"])
@app.get("/transactions/{order_id}", response_model=ConsoleTransactionDetail, tags=["console"])
@limiter.limit("60/minute")
def console_transaction_detail(
    request: Request,
    order_id: str,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> ConsoleTransactionDetail:
    try:
        order = commerce.get_order(order_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    events = ledger.for_trace(order.trace_id)
    return ConsoleTransactionDetail(
        order_id=order.order_id,
        trace_id=order.trace_id,
        status=order.status,
        amount_paise=order.amount_paise,
        buyer_agent_id=order.buyer_agent_id,
        merchant_id=order.merchant_id,
        quote_id=order.quote_id,
        idempotency_key=order.idempotency_key,
        created_at=order.created_at,
        events=[
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
    )


@app.get("/activity/stream", tags=["console"])
@limiter.limit("30/minute")
async def activity_stream(
    request: Request,
    ledger: LedgerRepository = Depends(get_ledger),
    _merchant: MerchantSession = Depends(get_merchant_session),
):
    """Server-Sent Events stream of new ledger activity (§46)."""
    import asyncio
    import json

    async def event_generator():
        last_sequence = ledger.max_sequence()
        while True:
            if await request.is_disconnected():
                break
            try:
                events = ledger.events_after(last_sequence, limit=100)
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> dict:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    events = ledger.all_events(limit=limit, offset=offset)
    total = ledger.count_events()
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> list[ConsoleApprovalRequest]:
    from sellable.contracts import OrderStatus

    orders = commerce.all_orders()
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> dict:
    try:
        commerce.approve_order(order_id)
        consent = commerce.issue_consent(order_id)
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> dict:
    try:
        commerce.mark_aborted(order_id, reason="Order rejected by merchant via console.")
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> ConsoleGrowthMetrics:
    from sellable.contracts import OrderStatus

    orders = commerce.all_orders()
    paid = [o for o in orders if o.status == OrderStatus.PAID]
    revenue = sum(o.amount_paise for o in paid)

    events = ledger.all_events(limit=1000)
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> ConsolePolicySettings:
    p = commerce.get_policy()
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> ConsolePolicySettings:
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    old_policy = commerce.policy
    new_policy = MerchantPolicy.model_validate({**old_policy.model_dump(), **updates})
    commerce.policy = new_policy
    # Persist policy to database
    _save_policy_to_db(new_policy)
    from sellable.contracts import LedgerActor

    commerce._record(
        trace_id="policy_update",
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> dict:
    try:
        order = commerce.get_order(order_id)
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
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> dict:
    orders = commerce.all_orders()
    paid = sum(1 for o in orders if o.status is OrderStatus.PAID)
    llm_mode = (
        "live" if _seller_llm is not None else "scripted"
    )
    return {
        "buyer_agent": {"status": "online", "mode": llm_mode},
        "seller_agent": {"status": "online", "mode": llm_mode},
        "llm": {
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "enabled": _seller_llm is not None,
        },
        "policy_engine": {"status": "healthy"},
        "agent_gateway": {"status": "online"},
        "payment_rail": {
            "provider": "razorpay",
            "mode": "test",
            "configured": settings.razorpay_is_configured,
        },
        "ledger": {"status": "recording"},
        "summary": {
            "total_orders": len(orders),
            "paid_orders": paid,
        },
    }


@app.post("/catalog/products", response_model=Product, tags=["console"])
@limiter.limit("10/minute")
def console_create_product(
    request: Request,
    body: Product,
    commerce: CommerceCore = Depends(get_commerce),
    ledger: LedgerRepository = Depends(get_ledger),
    _merchant: MerchantSession = Depends(get_merchant_session),
) -> Product:
    if body.merchant_id != commerce.policy.merchant_id:
        raise HTTPException(status_code=403, detail="Product merchant does not match the store")
    try:
        product = commerce.catalog.add_product(body)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    commerce._record(
        trace_id="catalog_update",
        actor=LedgerActor.HUMAN,
        action="catalog.product_created",
        inputs={"sku": product.sku, "price_paise": product.price_paise},
        output={"category": product.category, "stock": product.stock},
        reasoning_summary=f"Merchant added product {product.sku} to the catalog.",
    )
    return product
