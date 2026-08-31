export function Eyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="block w-3 h-3 flex-shrink-0 bg-[var(--bb-orange)]" />
      <span className="eyebrow">{label}</span>
    </div>
  );
}
