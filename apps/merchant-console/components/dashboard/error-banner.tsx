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
      aria-live="assertive"
      className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50 border border-red-200/60 px-4 py-3 shadow-card"
    >
      <span className="flex items-center justify-center size-7 rounded-full bg-red-100 shrink-0" aria-hidden>
        <IconWarning size={14} className="text-red-700" />
      </span>
      <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-red-900">
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 cursor-pointer rounded-full bg-white border border-black/10 shadow-sm px-4 h-8 text-[13px] font-medium text-neutral-900 transition-all hover:shadow hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
