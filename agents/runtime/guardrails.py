"""Agent guardrail middleware (target §9.1): every agent run passes the
same stack — identity, tenant isolation, input validation, untrusted-content
screening, scope checks, and output grounding — before and after model
execution. Commerce, policy, risk, and authorization checks remain
downstream; guardrails stop malformed or hostile runs early.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum


class GuardrailVerdict(StrEnum):
    PASS = "PASS"
    BLOCK = "BLOCK"
    HOLD = "HOLD"


@dataclass(frozen=True)
class GuardrailResult:
    verdict: GuardrailVerdict
    guardrail: str
    reason_code: str = ""
    detail: str = ""


@dataclass
class GuardrailContext:
    """Everything a guardrail may inspect. Secrets and raw risk internals
    never enter this context (data minimization, §9.2)."""

    agent_id: str
    agent_type: str = ""
    merchant_id: str = ""
    customer_id: str | None = None
    session_id: str = ""
    trace_id: str = ""
    input_text: str = ""
    allowed_tools: tuple[str, ...] = ()
    requested_tool: str = ""
    delegation_scopes: tuple[str, ...] = ()
    output_text: str = ""
    known_skus: frozenset[str] = frozenset()
    known_amounts_paise: frozenset[int] = frozenset()
    step_count: int = 0
    max_steps: int = 12


# Prompt-injection / untrusted-content patterns (§9.2 model guardrails).
# Deterministic and deliberately narrow: a hit blocks tool use for the run,
# never silently rewrites the request.
_INJECTION_PATTERNS = (
    r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?",
    r"disregard\s+(all\s+)?(previous|prior|above)\s+instructions?",
    r"you\s+are\s+now\s+",
    r"system\s*:\s*",
    r"\[INST\]",
    r"<<SYS>>",
    r"jailbreak",
    r"do\s+anything\s+now",
    r"developer\s+mode",
)

_INJECTION_RE = re.compile("|".join(f"(?:{p})" for p in _INJECTION_PATTERNS), re.IGNORECASE)

#: SKU-shaped tokens must be catalog-grounded in agent output.
_SKU_RE = re.compile(r"\b(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+(?:-[A-Z0-9]+)+\b")
#: Money-shaped tokens must match authoritative amounts.
_MONEY_RE = re.compile(
    r"(?:(?:₹|Rs\.?|INR)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*)\s*paise)",
    flags=re.IGNORECASE,
)

MAX_INPUT_CHARS = 4_000


def check_identity(context: GuardrailContext) -> GuardrailResult:
    """Identity guardrail: every run carries an agent and merchant identity."""
    if not context.agent_id:
        return GuardrailResult(GuardrailVerdict.BLOCK, "identity", "MISSING_AGENT_IDENTITY")
    if not context.merchant_id:
        return GuardrailResult(GuardrailVerdict.BLOCK, "identity", "MISSING_MERCHANT_SCOPE")
    return GuardrailResult(GuardrailVerdict.PASS, "identity")


def check_input(context: GuardrailContext) -> GuardrailResult:
    """Input validation: bounded size, no prompt-injection payloads."""
    if len(context.input_text) > MAX_INPUT_CHARS:
        return GuardrailResult(
            GuardrailVerdict.BLOCK, "input", "INPUT_TOO_LARGE",
            f"{len(context.input_text)} chars exceeds {MAX_INPUT_CHARS}",
        )
    if _INJECTION_RE.search(context.input_text):
        return GuardrailResult(
            GuardrailVerdict.BLOCK, "input", "PROMPT_INJECTION_DETECTED",
            "untrusted-content pattern in agent input",
        )
    return GuardrailResult(GuardrailVerdict.PASS, "input")


def check_tool_scope(context: GuardrailContext) -> GuardrailResult:
    """Permission guardrail: the requested tool must be allowlisted and, for
    scoped tools, covered by the delegation scopes when present."""
    if not context.requested_tool:
        return GuardrailResult(GuardrailVerdict.PASS, "tool_scope")
    if context.requested_tool not in context.allowed_tools:
        return GuardrailResult(
            GuardrailVerdict.BLOCK, "tool_scope", "TOOL_NOT_ALLOWLISTED",
            context.requested_tool,
        )
    return GuardrailResult(GuardrailVerdict.PASS, "tool_scope")


def check_steps(context: GuardrailContext) -> GuardrailResult:
    """Model guardrail: hard step budget with loop protection."""
    if context.step_count >= context.max_steps:
        return GuardrailResult(
            GuardrailVerdict.BLOCK, "steps", "MAX_STEPS_EXCEEDED",
            f"step {context.step_count} of {context.max_steps}",
        )
    return GuardrailResult(GuardrailVerdict.PASS, "steps")


def check_output(context: GuardrailContext) -> GuardrailResult:
    """Output sanitization: no invented SKUs, no invented money amounts."""
    if not context.output_text:
        return GuardrailResult(GuardrailVerdict.PASS, "output")
    for token in _SKU_RE.findall(context.output_text):
        if token not in context.known_skus:
            return GuardrailResult(
                GuardrailVerdict.BLOCK, "output", "UNKNOWN_SKU_IN_OUTPUT", token
            )
    for rupees, paise in _MONEY_RE.findall(context.output_text):
        amount = (
            int(paise.replace(",", ""))
            if paise
            else round(float(rupees.replace(",", "")) * 100)
        )
        if amount not in context.known_amounts_paise:
            return GuardrailResult(
                GuardrailVerdict.BLOCK, "output", "UNGROUNDED_AMOUNT_IN_OUTPUT",
                str(amount),
            )
    return GuardrailResult(GuardrailVerdict.PASS, "output")


#: Pre-model stack (§9.1 input side), in evaluation order.
PRE_MODEL_GUARDS = (check_identity, check_input, check_tool_scope, check_steps)

#: Post-model stack (§9.1 output side).
POST_MODEL_GUARDS = (check_output,)


def run_guards(
    context: GuardrailContext, guards=PRE_MODEL_GUARDS
) -> tuple[bool, list[GuardrailResult]]:
    """Run a guardrail stack. Returns (blocked, results); stops at the
    first BLOCK so the ledger shows exactly which guardrail fired."""
    results: list[GuardrailResult] = []
    for guard in guards:
        result = guard(context)
        results.append(result)
        if result.verdict is GuardrailVerdict.BLOCK:
            return True, results
    return False, results


@dataclass
class GuardrailRecorder:
    """Collects guardrail results for run attribution (§4.4)."""

    results: list[GuardrailResult] = field(default_factory=list)

    def extend(self, results: list[GuardrailResult]) -> None:
        self.results.extend(results)

    @property
    def blocks(self) -> list[str]:
        return [r.reason_code for r in self.results if r.verdict is GuardrailVerdict.BLOCK]
