# Deployment Guide

## Local Development

```bash
# Install
python -m pip install -e ".[dev]"

# Configure
cp .env.example .env
# Edit .env with Razorpay test credentials

# Run
python -m uvicorn sellable.main:app --reload

# Test
python -m pytest
python -m evals.runner.scenario_runner
```

---

## Docker

### Build

```bash
docker build -f infra/docker/Dockerfile -t sellable .
```

### Run

```bash
docker run -p 8000:8000 --env-file .env sellable
```

### Docker Compose

```bash
docker compose up
```

---

## Webhook Tunnel

Razorpay webhooks require a public URL. Use one of:

### ngrok

```bash
ngrok http 8000
```

### zrok

```bash
# First time
zrok enable <token>

# Share
zrok share http localhost:8000
```

### localtunnel

```bash
npx localtunnel --port 8000
```

Set the resulting URL as your Razorpay webhook endpoint: `<tunnel-url>/webhooks/razorpay`

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SELLABLE_ENVIRONMENT` | No | `development` | `development` or `production` |
| `DATABASE_URL` | No | `sqlite+pysqlite:///./data/sellable.db` | SQLAlchemy connection string |
| `RAZORPAY_KEY_ID` | Yes | — | Razorpay test-mode key ID |
| `RAZORPAY_KEY_SECRET` | Yes | — | Razorpay test-mode key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | — | Razorpay webhook signing secret |
| `ZROK_ENABLE_TOKEN` | No | — | zrok v2 enable token |

**Never commit `.env` with real credentials.**

---

## Production Checklist

This is a hackathon prototype. For production use, you would need:

- [ ] Replace SQLite with PostgreSQL
- [ ] Use environment-specific secrets management
- [ ] Add rate limiting on agent endpoints
- [ ] Implement full HMAC request signing on all agent endpoints
- [ ] Add OpenTelemetry tracing
- [ ] Set up proper logging (structured JSON)
- [ ] Add health check probes (liveness + readiness)
- [ ] Configure CORS for your frontend domain
- [ ] Use a process manager (PM2, systemd, or container orchestrator)
- [ ] Set up monitoring and alerting

---

## Architecture

```
                    ┌──────────────────┐
                    │    AI Buyer      │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Agent Gateway   │
                    │  agents.json     │
                    │  llms.txt        │
                    │  catalog.ai.json │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Seller Agent   │
                    │  search/quote    │
                    │  negotiate       │
                    │  upsell          │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Commerce Core   │
                    │  catalog         │
                    │  policy engine   │
                    │  order state     │
                    │  consent         │
                    └────────┬─────────┘
                             │
                       ALLOW / DENY
                        / HUMAN
                             │
                             ▼
                    ┌──────────────────┐
                    │    Razorpay      │
                    │    Test Mode     │
                    └────────┬─────────┘
                             │
                         webhook
                             │
                             ▼
                    ┌──────────────────┐
                    │    XAI Ledger    │
                    │  replay + audit  │
                    └──────────────────┘
```
