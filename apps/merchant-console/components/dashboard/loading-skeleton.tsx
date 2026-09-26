"use client";

import { SkeletonLine } from "./skeleton";

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-panel border border-black/[0.06] shadow-card"
      role="status"
      aria-label="Loading table"
    >
      <div className="border-b border-black/[0.06] bg-panel-2 px-6 py-4">
        <SkeletonLine className="h-3 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`px-6 py-4 ${i < rows - 1 ? "border-b border-black/[0.05]" : ""}`}
        >
          <div className="flex items-center gap-4">
            <SkeletonLine className="h-3 w-20" />
            <SkeletonLine className="h-3 w-32" />
            <SkeletonLine className="h-3 w-16" />
            <SkeletonLine className="ml-auto h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div
      className="space-y-3 rounded-2xl bg-panel border border-black/[0.05] p-6 shadow-card"
      role="status"
      aria-label="Loading"
    >
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="h-7 w-32" />
    </div>
  );
}
