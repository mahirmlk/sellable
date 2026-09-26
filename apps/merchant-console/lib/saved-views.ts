"use client";

// Named UI filter/sort prefs persisted to localStorage. UI-only: never stores
// secrets, tokens, or server state — just things like status filters or sort
// orders the merchant saved for a list view.

import { useCallback, useState } from "react";

export interface SavedView<T> {
  name: string;
  value: T;
}

export interface SavedViews<T> {
  getViews(): SavedView<T>[];
  saveView(name: string, value: T): void;
  deleteView(name: string): void;
}

function readStored<T>(storageKey: string): SavedView<T>[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is SavedView<T> =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as SavedView<T>).name === "string" &&
        "value" in v
    );
  } catch {
    return [];
  }
}

function writeStored<T>(storageKey: string, views: SavedView<T>[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(views));
  } catch {
    // Persistence is best-effort (private mode quotas, etc.).
  }
}

/**
 * One-way, best-effort migration of saved views from a legacy storage key
 * into the canonical `mc-views:*` key. Entries already present under the new
 * key win on name conflicts; the legacy key is removed after a successful
 * copy so a later delete cannot resurrect. Idempotent — safe to call on
 * every mount, but callers should run it synchronously before the
 * `SavedViewsBar` mounts so the migrated views render on first paint.
 */
export function migrateSavedViews<T>(legacyKey: string, newKey: string): void {
  try {
    if (typeof window === "undefined") return;
    if (legacyKey === newKey) return;
    const rawLegacy = window.localStorage.getItem(legacyKey);
    if (!rawLegacy) return;
    const parsed = JSON.parse(rawLegacy) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.removeItem(legacyKey);
      return;
    }
    const incoming = parsed.filter(
      (v): v is SavedView<T> =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as SavedView<T>).name === "string" &&
        "value" in v
    );
    if (incoming.length === 0) {
      window.localStorage.removeItem(legacyKey);
      return;
    }
    let existing: SavedView<T>[] = [];
    try {
      const rawNew = window.localStorage.getItem(newKey);
      if (rawNew) {
        const parsedNew = JSON.parse(rawNew) as unknown;
        if (Array.isArray(parsedNew)) {
          existing = parsedNew.filter(
            (v): v is SavedView<T> =>
              typeof v === "object" &&
              v !== null &&
              typeof (v as SavedView<T>).name === "string" &&
              "value" in v
          );
        }
      }
    } catch {
      existing = [];
    }
    const names = new Set(existing.map((v) => v.name));
    const merged = [...existing, ...incoming.filter((v) => !names.has(v.name))];
    window.localStorage.setItem(newKey, JSON.stringify(merged));
    window.localStorage.removeItem(legacyKey);
  } catch {
    // Migration is best-effort — the bar simply starts empty.
  }
}

export function useSavedViews<T>(storageKey: string): SavedViews<T> {
  const [views, setViews] = useState<SavedView<T>[]>(() =>
    readStored<T>(storageKey)
  );

  const getViews = useCallback((): SavedView<T>[] => views, [views]);

  const saveView = useCallback(
    (name: string, value: T): void => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setViews((prev) => {
        const next = [...prev.filter((v) => v.name !== trimmed), { name: trimmed, value }];
        writeStored(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const deleteView = useCallback(
    (name: string): void => {
      setViews((prev) => {
        const next = prev.filter((v) => v.name !== name);
        writeStored(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  return { getViews, saveView, deleteView };
}
