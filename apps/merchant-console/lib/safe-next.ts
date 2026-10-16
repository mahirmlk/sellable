// Central redirect target guard for auth flows.
// Only same-origin paths are allowed; protocol-relative (//evil), backslash,
// and control-char tricks fall back to /dashboard.
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  if (raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) {
    return "/dashboard";
  }
  return raw;
}
