import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="text-center px-6">
        <div className="font-[var(--font-mono)] text-[0.7rem] tracking-[0.17em] uppercase text-[var(--bb-grey-3)] mb-6">
          <span className="inline-block w-3 h-3 bg-[var(--bb-orange)] mr-3 align-middle" />
          ERROR 404
        </div>
        <h1 className="font-[var(--font-sans)] text-[clamp(3rem,8vw,6rem)] leading-[0.93] tracking-[-0.06em] font-normal text-[var(--bb-white)] mb-6">
          Page not found
        </h1>
        <p className="font-[var(--font-sans)] text-[1.1rem] text-[var(--bb-grey-1)] max-w-[440px] mx-auto mb-10 leading-relaxed">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/" className="btn-light">
            BACK TO HOME
          </Link>
          <Link href="/dashboard" className="btn-outline">
            OPEN DASHBOARD
          </Link>
        </div>
      </div>
    </main>
  );
}
