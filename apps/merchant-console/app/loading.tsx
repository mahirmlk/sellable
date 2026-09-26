export default function Loading() {
  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center gap-3 mb-4">
          <span className="w-2 h-2 bg-accent animate-[blink_1.4s_ease-in-out_infinite]" />
          <span className="w-2 h-2 bg-accent animate-[blink_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="w-2 h-2 bg-accent animate-[blink_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
        <p className="text-[13px] tracking-[0.14em] uppercase text-muted">
          Loading
        </p>
      </div>
    </main>
  );
}
