"use client";

import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function EmptyState({
  title,
  message,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  /** Per-context illustration icon — defaults to a neutral inbox glyph. */
  icon?: LucideIcon;
}) {
  return (
    <Empty
      role="status"
      className="gap-2 rounded-3xl border border-solid border-black/[0.05] bg-panel-2 px-6 py-16 shadow-card"
    >
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="mb-1 size-11 rounded-[18px] border border-hairline bg-panel text-ink-2 shadow-sm"
        >
          <Icon className="size-5" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </EmptyTitle>
        <EmptyDescription className="max-w-[28rem] text-[14px] text-muted">
          {message}
        </EmptyDescription>
      </EmptyHeader>
      {action ? (
        <EmptyContent>
          <div className="mt-4">{action}</div>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
