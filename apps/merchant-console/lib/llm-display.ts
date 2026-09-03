// Friendly display labels for LLM providers/models reported by the backend.
// The backend returns the raw active configuration (e.g. provider "opencode",
// model "mimo-v2.5-free"); the UI maps those to human-readable labels without
// ever hardcoding a status.

const PROVIDER_LABELS: Record<string, string> = {
  mock: "Mock",
  deterministic: "Mock",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  gemini: "Google",
};

const MODEL_LABELS: Record<string, string> = {
  "mimo-v2.5-free": "MiMo-V2.5 Free",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

export function providerLabel(provider: string | undefined | null): string {
  if (!provider) return "Mock";
  return PROVIDER_LABELS[provider.toLowerCase()] ?? provider;
}

export function modelLabel(model: string | undefined | null): string {
  if (!model) return "Deterministic";
  return MODEL_LABELS[model] ?? model;
}

export type LlmDisplayState =
  | "connected"
  | "unconfigured"
  | "error"
  | "scripted"
  | "unknown";

export function llmDisplayState(
  llm: { status?: string; state?: string } | null | undefined
): LlmDisplayState {
  if (!llm) return "unknown";
  const state = (llm.state || llm.status || "").toLowerCase();
  if (state === "connected" || state === "recording") return "connected";
  if (state === "unconfigured") return "unconfigured";
  if (state === "error") return "error";
  if (state === "scripted") return "scripted";
  return "unknown";
}