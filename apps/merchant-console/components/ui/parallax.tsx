"use client";

import { useEffect, useRef } from "react";

export function Parallax({
  children,
  speed = 0.12,
  className = "",
}: {
  children: React.ReactNode;
  speed?: number; // 0.05 = subtle, 0.18 = pronounced
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = el.getBoundingClientRect();
        const viewportH = window.innerHeight;
        // progress: 0 when below viewport, 1 when above
        const center = rect.top + rect.height / 2;
        const prog = (viewportH / 2 - center) / viewportH; // -0.5 .. 0.5
        const y = prog * speed * 100; // translate range
        el.style.transform = `translate3d(0, ${y}px, 0)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);

  return (
    <div ref={ref} className={className} style={{ willChange: "transform" }}>
      {children}
    </div>
  );
}
