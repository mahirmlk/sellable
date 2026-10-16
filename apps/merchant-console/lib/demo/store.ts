// Demo-local session state (UPDATE.md §6).
//
// Fixture data in fixtures.json is immutable and shared. Anything the
// visitor changes in Demo Mode (policy edits, read notifications, added
// products, chat orders, sessions, keys, approvals) lives in this
// localStorage overlay — never in production APIs, never in another
// tenant. resetDemo() restores the predictable fixture set.

import baseFixtures from "./fixtures.json";

export const DEMO_STATE_KEY = "sellable_demo_v1_state";

export interface DemoOverlay {
  policy: Record<string, unknown> | null;
  notificationsRead: string[];
  productsAdded: Array<Record<string, unknown>>;
  orderPatches: Record<string, Record<string, unknown>>;
  ordersAdded: Array<Record<string, unknown>>;
  missionsAdded: Array<Record<string, unknown>>;
  sessions: Record<string, Record<string, unknown>>;
  sessionsArchived: string[];
  keys: Array<Record<string, unknown>>;
  keysRevoked: string[];
  webhooksAdded: Array<Record<string, unknown>>;
  webhooksRemoved: string[];
  connectorsAdded: Array<Record<string, unknown>>;
  connectorsRemoved: string[];
  approvalsDecided: Record<string, string>;
  eventsAdded: Array<Record<string, unknown>>;
}

const EMPTY_OVERLAY: DemoOverlay = {
  policy: null,
  notificationsRead: [],
  productsAdded: [],
  orderPatches: {},
  ordersAdded: [],
  missionsAdded: [],
  sessions: {},
  sessionsArchived: [],
  keys: [],
  keysRevoked: [],
  webhooksAdded: [],
  webhooksRemoved: [],
  connectorsAdded: [],
  connectorsRemoved: [],
  approvalsDecided: {},
  eventsAdded: [],
};

function emptyOverlay(): DemoOverlay {
  return structuredClone(EMPTY_OVERLAY);
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asRecord(value: unknown): Record<string, Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, Record<string, unknown>>;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Corrupt/older localStorage shapes fall back field-by-field, never crash. */
function sanitizeOverlay(parsed: unknown): DemoOverlay {
  const base = emptyOverlay();
  if (typeof parsed !== "object" || parsed === null) return base;
  const p = parsed as Record<string, unknown>;
  return {
    policy:
      typeof p.policy === "object" && p.policy !== null && !Array.isArray(p.policy)
        ? (p.policy as Record<string, unknown>)
        : null,
    notificationsRead: asStringArray(p.notificationsRead),
    productsAdded: asArray(p.productsAdded),
    orderPatches: asRecord(p.orderPatches),
    ordersAdded: asArray(p.ordersAdded),
    missionsAdded: asArray(p.missionsAdded),
    sessions: asRecord(p.sessions),
    sessionsArchived: asStringArray(p.sessionsArchived),
    keys: asArray(p.keys),
    keysRevoked: asStringArray(p.keysRevoked),
    webhooksAdded: asArray(p.webhooksAdded),
    webhooksRemoved: asStringArray(p.webhooksRemoved),
    connectorsAdded: asArray(p.connectorsAdded),
    connectorsRemoved: asStringArray(p.connectorsRemoved),
    approvalsDecided: asStringRecord(p.approvalsDecided),
    eventsAdded: asArray(p.eventsAdded),
  };
}

export function loadOverlay(): DemoOverlay {
  if (typeof window === "undefined") return emptyOverlay();
  try {
    const raw = window.localStorage.getItem(DEMO_STATE_KEY);
    if (!raw) return emptyOverlay();
    return sanitizeOverlay(JSON.parse(raw));
  } catch {
    return emptyOverlay();
  }
}

export function saveOverlay(overlay: DemoOverlay): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(overlay));
  } catch {
    // Storage blocked — demo stays session-only in memory.
  }
}

export function mutateOverlay(
  mutate: (overlay: DemoOverlay) => void
): DemoOverlay {
  const overlay = loadOverlay();
  mutate(overlay);
  saveOverlay(overlay);
  return overlay;
}

/** Clear all demo-local changes. Re-entering Demo Mode starts coherent. */
export function resetDemo(): void {
  if (typeof window === "undefined") return;
  try {
    Object.keys(window.localStorage)
      .filter((k) => k === DEMO_STATE_KEY || k.startsWith("sellable_demo_"))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Ignore storage failures on reset.
  }
}

export type Fixtures = typeof baseFixtures;

export function getFixtures(): Fixtures {
  return baseFixtures;
}
