"use client";

import { IconWarning } from "./icons";

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border border-red-400/25 bg-red-400/[0.06] px-4 py-3"
    >
      <IconWarning size={14} className="shrink-0 text-red-400" />
      <p className="min-w-0 flex-1 font-[var(--font-sans)] text-[0.85rem] leading-relaxed text-[var(--bb-white-soft)]">
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 cursor-pointer border border-[var(--bb-line)] bg-transparent px-3 py-1.5 font-[var(--font-mono)] text-[0.62rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)] transition-colors hover:border-[var(--bb-grey-4)] hover:text-[var(--bb-white)]"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
