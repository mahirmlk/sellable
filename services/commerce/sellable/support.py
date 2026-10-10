"""Customer-service case seed and human-escalation payloads (target §26).

Cases are first-class records from Phase 3 so every consequential flow
can hand off to a human with full context (§26.3). Conversation,
agent-side resolution, and the Customer Service Agent runtime arrive in
Phase 4 — this module owns the case lifecycle and the escalation handoff
shape.
"""

from __future__ import annotations

from sellable.contracts import (
    EscalationPayload,
    SupportCase,
    SupportCasePriority,
    SupportCaseStatus,
    SupportCategory,
    utc_now,
)


_ALLOWED_TRANSITIONS: dict[SupportCaseStatus, frozenset[SupportCaseStatus]] = {
    SupportCaseStatus.OPEN: frozenset(
        {
            SupportCaseStatus.IN_PROGRESS,
            SupportCaseStatus.ESCALATED,
            SupportCaseStatus.RESOLVED,  # trivially answered inquiries
        }
    ),
    SupportCaseStatus.IN_PROGRESS: frozenset(
        {
            SupportCaseStatus.RESOLVED,
            SupportCaseStatus.ESCALATED,
            SupportCaseStatus.WAITING_FOR_CUSTOMER,
        }
    ),
    SupportCaseStatus.WAITING_FOR_CUSTOMER: frozenset({SupportCaseStatus.IN_PROGRESS}),
    SupportCaseStatus.ESCALATED: frozenset(
        {SupportCaseStatus.IN_PROGRESS, SupportCaseStatus.RESOLVED}
    ),
    SupportCaseStatus.RESOLVED: frozenset(),
}


class CaseError(ValueError):
    """The case cannot be used or transitioned."""


class CaseNotFoundError(CaseError, LookupError):
    """No such case for this merchant (foreign ids stay invisible)."""


def build_escalation_payload(
    *,
    customer_summary: str,
    issue_classification: str,
    order_context: dict[str, object] | None = None,
    actions_attempted: list[str] | None = None,
    policy_constraints: list[str] | None = None,
    risk_flags: list[str] | None = None,
    recommended_next_action: str,
    trace_id: str | None = None,
) -> EscalationPayload:
    """Assemble the §26.3 handoff: no reconstruction required downstream."""
    return EscalationPayload(
        customer_summary=customer_summary,
        issue_classification=issue_classification,
        order_context=dict(order_context or {}),
        actions_attempted=list(actions_attempted or []),
        policy_constraints=list(policy_constraints or []),
        risk_flags=list(risk_flags or []),
        recommended_next_action=recommended_next_action,
        trace_id=trace_id,
    )


class CaseService:
    def __init__(self, case_repo: object) -> None:
        self._cases = case_repo

    def get_case(self, case_id: str, merchant_id: str) -> SupportCase:
        case = self._cases.get(case_id, merchant_id)
        if case is None:
            raise CaseNotFoundError(f"Unknown case: {case_id}")
        return case

    def open_case(
        self,
        merchant_id: str,
        summary: str,
        *,
        customer_id: str | None = None,
        agent_id: str | None = None,
        order_id: str | None = None,
        checkout_id: str | None = None,
        category: SupportCategory = SupportCategory.OTHER,
        priority: SupportCasePriority = SupportCasePriority.MEDIUM,
        context: dict[str, object] | None = None,
    ) -> SupportCase:
        case = SupportCase(
            merchant_id=merchant_id,
            customer_id=customer_id,
            agent_id=agent_id,
            order_id=order_id,
            checkout_id=checkout_id,
            category=category,
            priority=priority,
            summary=summary,
            context=dict(context or {}),
        )
        self._cases.save(case)
        return case

    def escalate(
        self, case_id: str, merchant_id: str, payload: EscalationPayload
    ) -> SupportCase:
        case = self.get_case(case_id, merchant_id)
        self._move(case, SupportCaseStatus.ESCALATED)
        escalated = case.model_copy(
            update={
                "status": SupportCaseStatus.ESCALATED,
                "context": {**case.context, "escalation": payload.model_dump(mode="json")},
                "updated_at": utc_now(),
            }
        )
        self._cases.save(escalated)
        return escalated

    def begin_work(self, case_id: str, merchant_id: str) -> SupportCase:
        case = self.get_case(case_id, merchant_id)
        return self._transition(case, SupportCaseStatus.IN_PROGRESS)

    def resolve(self, case_id: str, merchant_id: str) -> SupportCase:
        case = self.get_case(case_id, merchant_id)
        return self._transition(case, SupportCaseStatus.RESOLVED)

    def wait_for_customer(self, case_id: str, merchant_id: str) -> SupportCase:
        case = self.get_case(case_id, merchant_id)
        return self._transition(case, SupportCaseStatus.WAITING_FOR_CUSTOMER)

    def list_open(self, merchant_id: str) -> list[SupportCase]:
        return self._cases.list_open(merchant_id)

    # ------------------------------------------------------------------

    def _move(self, case: SupportCase, target: SupportCaseStatus) -> None:
        if target not in _ALLOWED_TRANSITIONS[case.status]:
            raise CaseError(
                f"cannot move case from {case.status.value} to {target.value}"
            )

    def _transition(self, case: SupportCase, target: SupportCaseStatus) -> SupportCase:
        self._move(case, target)
        updated = case.model_copy(update={"status": target, "updated_at": utc_now()})
        self._cases.save(updated)
        return updated
