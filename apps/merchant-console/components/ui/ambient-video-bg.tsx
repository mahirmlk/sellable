"use client";

/**
 * Video-type live background that feels like a looping video but is pure CSS/Canvas.
 * Matches the SELLABLE dark + orange theme (#080808 / #ff6900).
 * Renders behind the whole page: drifting aurora, panning grid, grain, vignette.
 */
export function AmbientVideoBg() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--bb-black)]">
      {/* Base */}
      <div className="absolute inset-0 bg-[var(--bb-black)]" />

      {/* Aurora / flowing orange wash — simulates video gradient motion */}
      <div className="ambient-aurora absolute inset-0 opacity-[0.9]" />
      <div className="ambient-aurora-2 absolute inset-0 opacity-[0.55]" />

      {/* Large soft orbs that drift like video bokeh */}
      <div className="ambient-orb ambient-orb--a" />
      <div className="ambient-orb ambient-orb--b" />
      <div className="ambient-orb ambient-orb--c" />

      {/* Technical grid that pans slowly — video-type loop */}
      <div className="ambient-grid absolute inset-0" />

      {/* Thin diagonal scan that loops */}
      <div className="ambient-scan absolute inset-0 overflow-hidden">
        <div className="ambient-scan-line" />
      </div>

      {/* Grain texture — subtle static like film */}
      <div className="ambient-grain absolute inset-0" />

      {/* Vignette + top fade for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(0,0,0,0.65)]" />
      <div className="absolute inset-0 opacity-[0.55]" style={{
        background: "radial-gradient(120% 90% at 50% 0%, transparent 45%, rgba(0,0,0,0.7) 85%)"
      }} />


    </div>
  );
}
