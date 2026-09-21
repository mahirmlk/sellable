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
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-neutral-50/80 backdrop-blur-xl border border-black/[0.05] px-6 py-16 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <div className="flex items-center justify-center size-11 rounded-2xl bg-white border border-black/[0.06] shadow-sm text-[20px] mb-1" aria-hidden>
        ○
      </div>
      <p className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-900">
        {title}
      </p>
      <p className="max-w-[28rem] text-[14px] leading-relaxed text-neutral-500">
        {message}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
