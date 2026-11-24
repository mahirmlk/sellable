import { DurableObject } from "cloudflare:workers";

const BACKEND_NAME = "sellable-production-singleton";
const BACKEND_PORT = 8000;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const READINESS_ATTEMPTS = 100;
const READINESS_INTERVAL_MS = 200;

// Only the backend's known configuration is copied into the container. Worker
// bindings and unrelated secrets must never become container environment data.
const BACKEND_ENV_KEYS = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  "BUYER_AGENT_API_KEY_HASH",
  "BUYER_AGENT_HMAC_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "PAYMENT_PROVIDER",
  "SHIPPING_WEBHOOK_SECRET",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_TEMPERATURE",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "GOOGLE_API_KEY",
  "SELLABLE_ADMIN_API_KEY",
  "SELLABLE_ACP_ENABLED",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_FROM",
  "SMTP_RECIPIENTS",
  "SELLABLE_DEFAULT_PLAN",
  "CORS_ORIGINS",
];

function backendEnvironment(workerEnv) {
  const containerEnv = {
    SELLABLE_ENVIRONMENT:
      typeof workerEnv.SELLABLE_ENVIRONMENT === "string"
        ? workerEnv.SELLABLE_ENVIRONMENT
        : "production",
    PORT: String(BACKEND_PORT),
    WEB_CONCURRENCY: "1",
    UVICORN_WORKERS: "1",
    SELLABLE_MAINTENANCE_WORKER: "1",
    TRUST_PROXY_HEADERS: "1",
  };

  for (const key of BACKEND_ENV_KEYS) {
    if (typeof workerEnv[key] === "string") {
      containerEnv[key] = workerEnv[key];
    }
  }
  return containerEnv;
}

function backendStub(env) {
  // A single stable name is deliberate: process-local consent and payment
  // guards are safe only while the first release has one backend instance.
  return env.SELLABLE_BACKEND.getByName(BACKEND_NAME);
}

export class SellableBackend extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.starting = undefined;

    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  async fetch(request) {
    const container = this.ctx.container;
    if (!container) {
      return new Response("Backend container is unavailable", { status: 503 });
    }

    this.starting ??= this.startAndWaitForReadiness(container).finally(() => {
      this.starting = undefined;
    });

    try {
      await this.starting;
      const incomingUrl = new URL(request.url);
      incomingUrl.protocol = "http:";
      incomingUrl.hostname = "container";
      incomingUrl.port = "";

      const forwarded = new Request(incomingUrl, request);
      forwarded.headers.delete("host");
      forwarded.headers.delete("x-forwarded-for");
      const clientIp = request.headers.get("cf-connecting-ip");
      if (clientIp) {
        // Trust Cloudflare's edge-provided client address, never the caller's
        // X-Forwarded-For value. Uvicorn only trusts proxy headers behind this
        // private Worker-to-container hop.
        forwarded.headers.set("x-forwarded-for", clientIp);
      }
      forwarded.headers.set(
        "x-forwarded-proto",
        new URL(request.url).protocol.slice(0, -1),
      );

      return await container.getTcpPort(BACKEND_PORT).fetch(forwarded);
    } catch (error) {
      console.error(
        "Cloudflare backend request failed",
        error instanceof Error ? error.name : "unknown error",
      );
      return new Response("Backend temporarily unavailable", { status: 503 });
    }
  }

  async startAndWaitForReadiness(container) {
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "standard-1",
        enableInternet: true,
        env: backendEnvironment(this.env),
      });
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(BACKEND_PORT);
    let lastError;
    for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
      try {
        const response = await port.fetch("http://container/ready", {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new Error(`Readiness returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(READINESS_INTERVAL_MS);
    }
    throw new Error("Backend container did not become ready", { cause: lastError });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const environment =
      typeof env.SELLABLE_ENVIRONMENT === "string"
        ? env.SELLABLE_ENVIRONMENT
        : "production";
    if (
      !["development", "test"].includes(environment) &&
      url.protocol !== "https:"
    ) {
      return new Response("HTTPS is required", { status: 400 });
    }
    return backendStub(env).fetch(request);
  },

  async scheduled(_controller, env, context) {
    context.waitUntil(
      backendStub(env)
        .fetch(new Request("https://sellable.internal/health"))
        .then(async (response) => {
          await response.body?.cancel();
          if (!response.ok) {
            throw new Error(`Backend heartbeat returned ${response.status}`);
          }
        })
        .catch((error) => {
          console.error(
            "Cloudflare backend heartbeat failed",
            error instanceof Error ? error.name : "unknown error",
          );
        }),
    );
  },
};
