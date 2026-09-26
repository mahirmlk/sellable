// Recently opened commerce records for the command palette's "Recent" group.
// Only the record TYPE + ID are persisted (max 8, most recent first) — display
// data is always re-resolved from the live API by the palette, so a deleted or
// foreign record simply drops out and is never fabricated from stale payloads.
// Detail pages can adopt recordRecentVisit() later to widen the trail beyond
// palette opens; the shape and cap stay the same.

export type RecentRecordKind = "product" | "order";

export interface RecentRecordRef {
  type: RecentRecordKind;
  /** Product SKU or order id — the same id used by the detail route. */
  id: string;
}

const STORAGE_KEY = "sellable_recent_records";

export const MAX_RECENT_RECORDS = 8;

/** Persisted refs, newest first. Defensive: malformed storage reads as empty. */
export function readRecentRecords(): RecentRecordRef[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: RecentRecordRef[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const { type, id } = entry as { type?: unknown; id?: unknown };
      if ((type !== "product" && type !== "order") || typeof id !== "string" || !id) continue;
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, id });
      if (out.length >= MAX_RECENT_RECORDS) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Push a record to the front of the trail (deduped, capped). Best-effort. */
export function recordRecentVisit(ref: RecentRecordRef): void {
  try {
    const rest = readRecentRecords().filter(
      (r) => !(r.type === ref.type && r.id === ref.id)
    );
    const next = [ref, ...rest].slice(0, MAX_RECENT_RECORDS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence is best-effort; the palette works without it.
  }
}
