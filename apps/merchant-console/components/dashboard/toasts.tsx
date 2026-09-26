"use client";

// Toast system — transient confirmations with optional Undo action
// (the recovery path that makes fast, confirmation-free flows safe).
// Mount <ToastViewport /> once in DashboardShell; trigger with toast().

import { useSyncExternalStore } from "react";

export type ToastTone = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onAction: () => void };
}

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): ToastItem[] {
  return toasts;
}

export function toast(item: Omit<ToastItem, "id">) {
  const id = nextId++;
  toasts = [...toasts, { ...item, id }];
  notify();
  window.setTimeout(() => dismissToast(id), 4500);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

const TONE_ACCENT: Record<ToastTone, string> = {
  info: "bg-accent",
  success: "bg-green-600",
  error: "bg-red-600",
};

export function ToastViewport() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div
      className="fixed bottom-5 right-5 z-[90] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2.5rem)]"
      role="region"
      aria-label="Notifications"
    >
      {items.map((t) => (
        <div key={t.id} className="toast-item rounded-[16px] pl-3.5 pr-2 py-3 flex items-start gap-3 bg-panel border border-hairline shadow-pop">
          <span className={`mt-1.5 size-2 rounded-full shrink-0 ${TONE_ACCENT[t.tone ?? "info"]}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-ink leading-snug">{t.title}</div>
            {t.description ? (
              <div className="mt-0.5 text-[12.5px] text-muted leading-snug">{t.description}</div>
            ) : null}
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action?.onAction();
                  dismissToast(t.id);
                }}
                className="mt-1.5 text-[12.5px] font-medium text-accent-strong hover:underline cursor-pointer"
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            className="size-7 rounded-full flex items-center justify-center text-faint hover:text-ink hover:bg-ink/[0.05] transition-colors cursor-pointer shrink-0"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
