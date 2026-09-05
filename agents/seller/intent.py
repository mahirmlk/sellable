"""Deterministic buyer-turn intent classification for conversational checkout.

Pure pattern matching — no LLM. The Seller Agent (and the console chat
endpoint) use this to decide whether a typed buyer message is a negotiation
offer ("can you do 1.3k?"), a price query ("any discount?"), a typed
acceptance ("yes, add it"), or an ordinary shopping turn. The commerce core
still owns every decision; this module only reads intent out of text.
"""

from __future__ import annotations

import re
from enum import StrEnum

from pydantic import BaseModel


class TurnKind(StrEnum):
    NEGOTIATE_OFFER = "NEGOTIATE_OFFER"  # explicit amount: "can you do 1.3k?"
    PRICE_QUERY = "PRICE_QUERY"  # "any discount?" / "what's your best price?"
    ACCEPT_UPSELL = "ACCEPT_UPSELL"  # typed "yes, add it" after a suggestion
    OTHER = "OTHER"  # normal discovery / question / checkout flow


class BuyerTurnIntent(BaseModel):
    kind: TurnKind
    offer_paise: int | None = None


# Currency-marked amounts: ₹1,300 · Rs. 1300 · INR 1,300.50
_CURRENCY_AMOUNT = re.compile(
    r"(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d+)?)", re.IGNORECASE
)
# k-suffixed amounts: 1.3k · 1.3K · 2k
_K_AMOUNT = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\s*k\b", re.IGNORECASE)
# rupees-suffixed amounts: 1300 rupees · 1300rs · Rs 1300 covered above
_RUPEES_AMOUNT = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\s*rupees\b", re.IGNORECASE)
# Bare numbers next to an offer verb: "do 1300", "pay 1300", "in 1,300"
_BARE_AMOUNT = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\b")
# Offer verbs / prepositions that make a nearby bare number an offer.
_OFFER_CONTEXT = re.compile(
    r"(?:can\s+you\s+(?:do|give|make|offer|sell|take|go)|will\s+you\s+take"
    r"|i\s*'?ll\s+pay|pay\s+|take\s+|make\s+it|do\s+it\s+for|for\s+$"
    r"|\bin\s+$|\bfor\s+)",
    re.IGNORECASE,
)
# Phrases that ask about price movement without naming an amount.
_PRICE_QUERY = re.compile(
    r"(?:discount|best\s+price|lowest\s+price|lower\s+the\s+price"
    r"|reduce\s+the\s+price|come\s+down|cheaper|price\s+down|negotiate"
    r"|whats?\s+your\s+(?:best|lowest)|best\s+you\s+can\s+do)",
    re.IGNORECASE,
)
# Typed acceptance of a suggested add-on.
_ACCEPT_UPSELL = re.compile(
    r"^(?:yes,?\s*)?(?:please\s+)?(?:add|include|take)\s+(?:it|that|the\s+\w+)"
    r"|^(?:yes|yeah|yep|sure|ok(?:ay)?)\b.*\badd\b"
    r"|^i'?ll\s+take\s+(?:it|both|that)",
    re.IGNORECASE,
)


def _to_paise(amount_text: str, kilo: bool = False) -> int:
    """Normalize a rupee figure to integer paise. ``1.3k`` → 130000."""
    value = float(amount_text.replace(",", ""))
    if kilo:
        value *= 1_000
    return round(value * 100)


# Budget framings: an amount framed as a budget is not an offer.
_BUDGET_CONTEXT = re.compile(
    r"\b(?:under|below|up\s*to|upto|less\s+than|max(?:imum)?|budget)\b[^.]{0,24}$",
    re.IGNORECASE,
)


def parse_offer_paise(message: str) -> int | None:
    """Extract the offer amount from a buyer message, in paise.

    Understands ``₹1,300``, ``Rs. 1300``, ``INR 1,300.50``, ``1.3k``,
    ``1300 rupees``, and bare numbers in offer context (``do 1300``,
    ``I'll pay 1300``, ``in 1,300``). Amounts framed as a budget
    ("under ₹2,000") are not offers. Returns None when no amount is present.
    """
    for match in _CURRENCY_AMOUNT.finditer(message):
        if _BUDGET_CONTEXT.search(message[max(0, match.start() - 32) : match.start()]):
            continue
        return _to_paise(match.group(1))
    match = _K_AMOUNT.search(message)
    if match:
        return _to_paise(match.group(1), kilo=True)
    match = _RUPEES_AMOUNT.search(message)
    if match:
        return _to_paise(match.group(1))
    # Bare number: only an offer when an offer verb/preposition frames it.
    for match in _BARE_AMOUNT.finditer(message):
        prefix = message[max(0, match.start() - 40) : match.end() + 8]
        if _BUDGET_CONTEXT.search(message[max(0, match.start() - 32) : match.start()]):
            continue
        if _OFFER_CONTEXT.search(prefix):
            return _to_paise(match.group(1))
    return None


def classify_buyer_message(message: str) -> BuyerTurnIntent:
    """Classify one buyer turn. Deterministic: same text, same answer."""
    offer_paise = parse_offer_paise(message)
    if offer_paise is not None:
        return BuyerTurnIntent(kind=TurnKind.NEGOTIATE_OFFER, offer_paise=offer_paise)
    if _PRICE_QUERY.search(message):
        return BuyerTurnIntent(kind=TurnKind.PRICE_QUERY)
    if _ACCEPT_UPSELL.search(message.strip()):
        return BuyerTurnIntent(kind=TurnKind.ACCEPT_UPSELL)
    return BuyerTurnIntent(kind=TurnKind.OTHER)
