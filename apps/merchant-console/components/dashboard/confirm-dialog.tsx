"use client";

// Confirmation dialog for irreversible actions (refunds, revocations,
// rejections). Built on the vendored shadcn dialog primitive (Base UI):
// focus moves in on open (least destructive control), Tab is trapped by
// the primitive, Escape closes unless busy, and focus returns to the
// invoking element. Destructive variants can require typing a
// confirmation word ("type-to-confirm").
//
// The visible body is a separate inner component so it mounts fresh
// per open — typed input never leaks between invocations.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !props.busy) props.onCancel();
      }}
    >
      {props.open ? <ConfirmDialogBody {...props} /> : null}
    </Dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  typeToConfirm?: string;
  /** Extra gate: when true the confirm button stays disabled (e.g. invalid input). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialogBody({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  typeToConfirm,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");

  // Focus choreography: move focus in on mount (least destructive first),
  // return it to the invoker on unmount. External-system sync only.
  useEffect(() => {
    const invoker = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      (typeToConfirm ? inputRef.current : cancelRef.current)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      invoker?.focus?.();
    };
  }, [typeToConfirm]);

  const gated = Boolean(typeToConfirm) && typed !== typeToConfirm;

  return (
    <DialogContent
      showCloseButton={false}
      className="rounded-[20px] w-full max-w-[440px] p-6 bg-popover border border-hairline shadow-pop gap-0"
    >
      <DialogTitle className="font-display text-[24px] leading-tight text-ink">
        {title}
      </DialogTitle>
      {description ? (
        <DialogDescription
          render={
            <div className="mt-2.5 text-[14px] leading-relaxed text-muted" />
          }
        >
          {description}
        </DialogDescription>
      ) : null}

      {typeToConfirm ? (
        <label className="mt-4 block">
          <span className="text-[12px] text-faint">
            Type <span className="font-mono text-ink-2">{typeToConfirm}</span> to confirm
          </span>
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1.5 w-full h-9 rounded-[12px] bg-panel border border-hairline px-3 text-[14px] text-ink focus:outline-none focus:border-accent"
            autoComplete="off"
          />
        </label>
      ) : null}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center h-9 px-4 rounded-full bg-panel border border-hairline text-[13px] font-medium text-ink-2 hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || gated || confirmDisabled}
          className={`inline-flex items-center h-9 px-4 rounded-full text-[13px] font-medium text-panel transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${
            tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-ink hover:bg-ink-2"
          }`}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </DialogContent>
  );
}
