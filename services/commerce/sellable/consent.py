"""Transaction-bound, single-use consent validation."""

from __future__ import annotations

import threading
from datetime import datetime

from sellable.contracts import Consent, ConsentStatus, utc_now


class ConsentValidationError(ValueError):
    pass


class ConsentService:
    def __init__(self) -> None:
        self._consents: dict[str, Consent] = {}
        self._lock = threading.Lock()

    def issue(self, consent: Consent) -> Consent:
        if consent.consent_id in self._consents:
            raise ConsentValidationError("Consent ID already exists")
        self._consents[consent.consent_id] = consent
        return consent

    def get(self, consent_id: str) -> Consent | None:
        return self._consents.get(consent_id)

    def active_for_order(
        self, order_id: str, *, now: datetime | None = None
    ) -> Consent | None:
        """Return the still-usable consent bound to an order, if any.

        Expired consents are NOT active: without this check an expired but
        never-consumed consent blocks re-issue forever and wedges the order
        out of payment.
        """
        current = now or utc_now()
        for consent in self._consents.values():
            if (
                consent.order_id == order_id
                and consent.status is ConsentStatus.ISSUED
                and consent.expires_at > current
            ):
                return consent
        return None

    def consume(
        self,
        consent_id: str,
        *,
        order_id: str,
        amount_paise: int,
        payee_id: str,
        now: datetime | None = None,
    ) -> Consent:
        # Atomic read-modify-write: two threads must never both observe
        # ISSUED for the same consent (single-use would silently break).
        with self._lock:
            consent = self._consents.get(consent_id)
            if consent is None:
                raise ConsentValidationError("Consent does not exist")
            if consent.status is not ConsentStatus.ISSUED:
                raise ConsentValidationError("Consent is not available for use")
            if consent.expires_at <= (now or utc_now()):
                expired = consent.model_copy(update={"status": ConsentStatus.EXPIRED})
                self._consents[consent_id] = expired
                raise ConsentValidationError("Consent has expired")
            if (consent.order_id, consent.amount_paise, consent.payee_id) != (
                order_id,
                amount_paise,
                payee_id,
            ):
                raise ConsentValidationError("Consent is not bound to this transaction")
            used = consent.model_copy(update={"status": ConsentStatus.USED})
            self._consents[consent_id] = used
            return used
