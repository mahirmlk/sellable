"use client";

import { useEffect } from "react";

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
        <div className="font-[var(--font-mono)] text-[0.7rem] tracking-[0.17em] uppercase text-[var(--bb-grey-3)] mb-6">
          <span className="inline-block w-3 h-3 bg-red-500 mr-3 align-middle" />
          SYSTEM ERROR
        </div>
        <h1 className="font-[var(--font-sans)] text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.93] tracking-[-0.06em] font-normal text-[var(--bb-white)] mb-6">
          Something went wrong
        </h1>
        <p className="font-[var(--font-sans)] text-[1.1rem] text-[var(--bb-grey-1)] max-w-[440px] mx-auto mb-10 leading-relaxed">
          An unexpected error occurred. Please try again or return to the
          dashboard.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button onClick={reset} className="btn-light">
            TRY AGAIN
          </button>
          <a href="/" className="btn-outline">
            BACK TO HOME
          </a>
        </div>
      </div>
    </main>
  );
}
