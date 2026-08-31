# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SELLABLE, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email the maintainers directly or use GitHub's private vulnerability reporting feature.

## Scope

SELLABLE handles financial transactions via Razorpay test-mode. Security-relevant areas include:

- **Payment flow** — order creation, webhook verification, refund processing
- **Agent authentication** — HMAC signed-key auth for agent API endpoints
- **Consent model** — single-use, transaction-bound consent tokens
- **Policy engine** — deterministic guardrails that prevent unauthorized money movement
- **Ledger integrity** — append-only audit trail that must not be tampered with

## Design Principles

- **Agents propose, systems decide** — no LLM output directly mutates financial state
- **Deterministic policy engine** — all financial actions pass through a testable, rule-based gate
- **Single-use consent** — consent tokens are bound to one transaction and cannot be reused
- **Idempotent operations** — duplicate webhooks and order creation are safely rejected
- **Append-only ledger** — every money-touching event leaves an immutable audit trail

## Known Limitations

- This is a hackathon prototype, not production software
- Razorpay integration uses test-mode credentials only
- A built-in demo API key (`sellable_demo_key_001`) remains usable in test mode; production deployments should rely on `BUYER_AGENT_API_KEY_HASH` entries and `BUYER_AGENT_HMAC_SECRET`
- Agent endpoints support HMAC-SHA256 request signing with timestamp freshness and nonce replay protection

## Dependency Security

Run `pip audit` regularly to check for known CVEs in dependencies.

```bash
pip install pip-audit
pip-audit
```
