"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// One-shot scroll entrance: fades + rises once when the block enters the
// viewport, then disconnects. Transform + opacity only (compositor-friendly),
// no scroll listeners, no re-renders after showing.
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer available — reveal on the next tick, not synchronously.
      const t = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(t);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = {
    transitionDelay: `${delay}ms`,
    "--reveal-y": `${y}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      style={style}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
