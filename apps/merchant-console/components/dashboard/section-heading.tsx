"use client";

import type { ReactNode } from "react";

/* Section heading — consistent finishing for every dashboard section.
   shadcn CardHeader-style hierarchy: optional mono eyebrow, 15px semibold
   title, muted description, right-side action. Replaces oversized
   display-type section labels so sections scan instead of shout. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint mb-1.5">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink leading-snug">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2 pt-0.5">{action}</div>
      ) : null}
    </div>
  );
}
