// Shared auth form styles. Sign-in owns the canonical values; sign-up,
// forgot-password, and reset-password import from here instead of reaching
// into another page (cross-page imports couple routes together).
export const INPUT_DARK =
  "w-full h-12 bg-[var(--bb-black)] border border-[var(--bb-line)] px-4 text-[15px] text-[var(--bb-white)] placeholder:text-[var(--bb-grey-3)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors";
export const LABEL_DARK =
  "font-[var(--font-mono)] text-[0.64rem] tracking-[0.12em] uppercase text-[var(--bb-grey-2)]";
export const PRIMARY_ORANGE =
  "btn-orange-primary w-full !min-h-[52px] !text-[0.74rem] disabled:opacity-50 disabled:cursor-not-allowed";
export const INLINE_LINK =
  "font-medium text-[var(--bb-orange)] hover:underline focus-visible:outline-2 focus-visible:outline-accent";
