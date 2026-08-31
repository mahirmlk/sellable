"use client";

import { useEffect, useState } from "react";

export function AnimatedCounter({
  target,
  duration = 1200,
  prefix = "",
  suffix = "",
  className = "",
}: {
  target: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * target);
      setCount(current);
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [started, target, duration]);

  return (
    <span
      className={className}
      ref={(el) => {
        if (el && !started) {
          const observer = new IntersectionObserver(
            ([entry]) => {
              if (entry.isIntersecting) {
                setStarted(true);
                observer.disconnect();
              }
            },
            { threshold: 0.5 }
          );
          observer.observe(el);
        }
      }}
    >
      {prefix}
      {count.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}
