export function CornerBrackets() {
  return (
    <>
      {/* Top-left */}
      <span className="absolute top-[18px] left-[18px] w-[22px] h-[22px] border-t border-l border-[var(--bb-grey-3)] pointer-events-none" />
      {/* Top-right */}
      <span className="absolute top-[18px] right-[18px] w-[22px] h-[22px] border-t border-r border-[var(--bb-grey-3)] pointer-events-none" />
      {/* Bottom-left */}
      <span className="absolute bottom-[18px] left-[18px] w-[22px] h-[22px] border-b border-l border-[var(--bb-grey-3)] pointer-events-none" />
      {/* Bottom-right */}
      <span className="absolute bottom-[18px] right-[18px] w-[22px] h-[22px] border-b border-r border-[var(--bb-grey-3)] pointer-events-none" />
    </>
  );
}
