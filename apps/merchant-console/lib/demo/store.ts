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

export function loadOverlay(): DemoOverlay {
  if (typeof window === "undefined") return emptyOverlay();
  try {
    const raw = window.localStorage.getItem(DEMO_STATE_KEY);
    if (!raw) return emptyOverlay();
    const parsed = JSON.parse(raw) as Partial<DemoOverlay>;
    return { ...emptyOverlay(), ...parsed };
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
