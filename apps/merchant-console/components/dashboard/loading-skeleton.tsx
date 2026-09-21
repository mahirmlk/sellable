"use client";

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden border border-[var(--bb-line)]"
      role="status"
      aria-label="Loading table"
    >
      <div className="border-b border-[var(--bb-line)] bg-[var(--bb-panel)] px-5 py-3">
        <div className="skeleton h-3 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`px-5 py-4 ${i < rows - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}
        >
          <div className="flex items-center gap-4">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-3 w-32" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton ml-auto h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div
      className="space-y-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] p-5"
      role="status"
      aria-label="Loading"
    >
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-8 w-32" />
    </div>
  );
}
