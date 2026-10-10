# SELLABLE — Architecture (RETIRED)

> **This document is retired.** `SELLABLE_ARCHITECTURE.md` is the
> authoritative target platform architecture since the Phase 0 revamp
> (2026-10-07). The buildathon vertical-slice history below is preserved
> in git (`git log -- ARCHITECTURE.md`); do not extend this file.

## What superseded what

| Old (buildathon slice) | Current (target platform) |
|---|---|
| Buyer + Seller agents in-core | Seller + Customer Service agents in-core; external agents are gateway clients (`SELLABLE_ARCHITECTURE.md` §7) |
| Quote-only flow (`CartMandate`) | Persistent carts, quotes, checkout FSM, orders (`§18`, `§21`) |
| Consent-only authorization | Delegation + authorization service with transaction binding (`§14`) |
| Policy engine only | Policy, risk/fraud, trust/reputation as separate layers (`§24`, `§32`) |
| Razorpay-only rail | Provider protocol: Razorpay, Stripe (test), simulated (`§25`) |
| XAI ledger only | Event bus + ledger + observability + evaluation + sandbox (`§27–§31`) |
| Single REST gateway | REST + MCP + A2A + UCP over canonical commands (`§16–§17`) |

## Canonical references

- Target architecture: `SELLABLE_ARCHITECTURE.md` (§49 phases, §54 checklist)
- External agents: `docs/AGENT_INTEGRATION.md`
- Connectors/carriers/providers: `docs/CONNECTORS.md`
- Full history: `git log --follow -- ARCHITECTURE.md`
