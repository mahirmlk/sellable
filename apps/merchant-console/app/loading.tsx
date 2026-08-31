export default function Loading() {
  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center gap-3 mb-4">
          <span className="w-2 h-2 bg-[var(--bb-orange)] animate-[blink_1.4s_ease-in-out_infinite]" />
          <span className="w-2 h-2 bg-[var(--bb-orange)] animate-[blink_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="w-2 h-2 bg-[var(--bb-orange)] animate-[blink_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
        <p className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          Loading
        </p>
      </div>
    </main>
  );
}
