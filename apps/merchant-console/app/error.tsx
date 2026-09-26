"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="text-center px-6">
        <div className="text-[13px] tracking-[0.17em] uppercase text-muted mb-6">
          <span className="inline-block w-3 h-3 bg-red-600 mr-3 align-middle" />
          SYSTEM ERROR
        </div>
        <h1 className="font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.93] tracking-[-0.06em] text-ink mb-6">
          Something went wrong
        </h1>
        <p className="text-[1.1rem] text-muted max-w-[440px] mx-auto mb-10 leading-relaxed">
          An unexpected error occurred. Please try again or return to the
          dashboard.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-ink text-panel text-[13px] font-semibold transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
          >
            TRY AGAIN
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-panel border border-hairline text-ink-2 text-[13px] font-medium transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
          >
            BACK TO HOME
          </Link>
        </div>
      </div>
    </main>
  );
}
