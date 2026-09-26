import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="text-center px-6">
        <div className="text-[13px] tracking-[0.17em] uppercase text-muted mb-6">
          <span className="inline-block w-3 h-3 bg-accent mr-3 align-middle" />
          ERROR 404
        </div>
        <h1 className="font-display text-[clamp(3rem,8vw,6rem)] leading-[0.93] tracking-[-0.06em] text-ink mb-6">
          Page not found
        </h1>
        <p className="text-[1.1rem] text-muted max-w-[440px] mx-auto mb-10 leading-relaxed">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-panel border border-hairline text-ink-2 text-[13px] font-medium transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
          >
            BACK TO HOME
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-ink text-panel text-[13px] font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
          >
            OPEN DASHBOARD
          </Link>
        </div>
      </div>
    </main>
  );
}
