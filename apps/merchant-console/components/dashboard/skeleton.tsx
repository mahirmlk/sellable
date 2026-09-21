export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse bg-black/[0.06] rounded-lg ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-white/60 backdrop-blur-xl border border-black/[0.05] p-6 space-y-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="h-7 w-32 rounded-lg" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="px-6 py-4 flex items-center gap-4" aria-hidden>
      <SkeletonLine className="h-3 w-16" />
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="h-3 w-20" />
      <SkeletonLine className="h-3 w-12 ml-auto" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-2xl bg-white/60 backdrop-blur-xl border border-black/[0.05] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]" role="status" aria-label="Loading">
      <div className="px-6 py-4 border-b border-black/[0.06] bg-neutral-50/80">
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
            <SkeletonLine className="h-3 w-12 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]" aria-hidden>
      <div className="space-y-2">
        <SkeletonLine className="h-7 w-48 rounded-lg" />
        <SkeletonLine className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
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
