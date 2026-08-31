export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="border border-[var(--bb-line)] p-5 space-y-3">
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="h-8 w-32" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="px-5 py-4 flex items-center gap-4">
      <SkeletonLine className="h-3 w-16" />
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="h-3 w-20" />
      <SkeletonLine className="h-3 w-12 ml-auto" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="border border-[var(--bb-line)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
        <SkeletonLine className="h-3 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`px-5 py-4 ${i < rows - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}
        >
          <div className="flex items-center gap-4">
            <SkeletonLine className="h-3 w-20" />
            <SkeletonLine className="h-3 w-32" />
            <SkeletonLine className="h-3 w-16" />
            <SkeletonLine className="h-3 w-12 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <SkeletonLine className="h-6 w-40" />
        <SkeletonLine className="h-3 w-64" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <SkeletonTable rows={6} />
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonTable rows={3} />
        </div>
      </div>
    </div>
  );
}
