"use client";

/**
 * Static page backdrop — solid black, a faint fixed grid, and a vignette.
 * No animated layers: the previous drifting aurora / orbs / panning grid /
 * scan sweep / grain jitter forced full-page repaints and caused the
 * visible glitching on the landing page.
 */
export function AmbientVideoBg() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--bb-black)]">
      {/* Base */}
      <div className="absolute inset-0 bg-[var(--bb-black)]" />

      {/* Faint static grid */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(90% 85% at 50% 30%, black 45%, transparent 92%)",
        }}
      />

      {/* Vignette + top fade for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(0,0,0,0.65)]" />
    </div>
  );
}
