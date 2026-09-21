"use client";

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-white/70 backdrop-blur-xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]"
      role="status"
      aria-label="Loading table"
    >
      <div className="border-b border-black/[0.06] bg-neutral-50/80 px-6 py-4">
        <div className="h-3 w-32 animate-pulse rounded-lg bg-black/[0.06]" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`px-6 py-4 ${i < rows - 1 ? "border-b border-black/[0.05]" : ""}`}
        >
          <div className="flex items-center gap-4">
            <div className="h-3 w-20 animate-pulse rounded-lg bg-black/[0.06]" />
            <div className="h-3 w-32 animate-pulse rounded-lg bg-black/[0.06]" />
            <div className="h-3 w-16 animate-pulse rounded-lg bg-black/[0.06]" />
            <div className="ml-auto h-3 w-12 animate-pulse rounded-lg bg-black/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div
      className="space-y-3 rounded-2xl bg-white/60 backdrop-blur-xl border border-black/[0.05] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      role="status"
      aria-label="Loading"
    >
      <div className="h-3 w-24 animate-pulse rounded-lg bg-black/[0.06]" />
      <div className="h-7 w-32 animate-pulse rounded-lg bg-black/[0.06]" />
    </div>
  );
}
