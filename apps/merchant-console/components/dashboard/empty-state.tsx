"use client";

import type { ReactNode } from "react";

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-[var(--bb-line)] bg-[var(--bb-panel)] px-6 py-12 text-center">
      <p className="font-[var(--font-sans)] text-[0.95rem] font-medium text-[var(--bb-white)]">
        {title}
      </p>
      <p className="max-w-[28rem] font-[var(--font-sans)] text-[0.85rem] leading-relaxed text-[var(--bb-grey-2)]">
        {message}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
