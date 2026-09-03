export function OrangeCTA() {
  return (
    <section className="orange-cta relative overflow-hidden">
      {/* video-type noise + moving gradient */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {/* subtle grain */}
        <div className="absolute inset-0 opacity-[0.08] mix-blend-soft-light" style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"
        }} />
        {/* drifting diagonal highlight — loops like video */}
        <div className="absolute -inset-[40%] opacity-20" style={{
          background: "linear-gradient(108deg, transparent 30%, rgba(255,255,255,0.22) 42%, transparent 55%)",
          animation: "shimmer-sweep 5s ease-in-out infinite",
        }} />
        <div className="absolute inset-0 opacity-20" style={{
          background: "linear-gradient(180deg, rgba(0,0,0,0.0), rgba(0,0,0,0.06))",
        }} />
        {/* soft orb */}
        <div className="absolute -right-24 -top-24 w-[560px] h-[560px] rounded-full blur-[42px] opacity-[0.16]" style={{ background: "radial-gradient(circle at 30% 30%, white, transparent 64%)" }} />
      </div>

      <div className="page-frame relative">
        <div className="inline-flex items-center gap-2 border border-black/10 bg-black/[0.06] px-3 py-1.5">
          <span className="w-[5px] h-[5px] bg-black animate-[pulse_1.5s_ease-in-out_infinite]" />
          <span className="font-[var(--font-mono)] text-[0.62rem] tracking-[0.14em] uppercase text-black/70">Live on Razorpay test mode</span>
          <span className="font-[var(--font-mono)] text-[0.58rem] text-black/45">— webhooks verified</span>
        </div>
        <h2 className="mt-6">
          Make your store
          <br />
          agent-ready today
        </h2>
        <p className="mt-6 font-[var(--font-sans)] text-[1.2rem] leading-relaxed text-[#080808] opacity-80 max-w-[600px]">
          Join the next generation of commerce. Let AI buyers discover,
          negotiate with, and purchase from your store — safely and with full
          audit trails.
        </p>
        <div className="flex flex-wrap items-center gap-4 mt-10">
          <a href="/signup" className="btn-orange-primary">
            CREATE ACCOUNT
          </a>
          <a href="/login" className="btn-orange-secondary">
            SIGN IN
          </a>
        </div>
        {/* live trust row */}
        <div className="mt-10 flex flex-wrap items-center gap-3 font-[var(--font-mono)] text-[0.62rem] tracking-[0.08em] uppercase text-black/55">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-[5px] h-[5px] bg-black/70" /> Consent-gated
          </span>
          <span className="w-px h-3 bg-black/15" />
          <span className="inline-flex items-center gap-1.5">
            <span className="w-[5px] h-[5px] bg-black/70" /> Policy-bounded
          </span>
          <span className="w-px h-3 bg-black/15" />
          <span className="inline-flex items-center gap-1.5">
            <span className="w-[5px] h-[5px] bg-black/70" /> Ledger-audited
          </span>
        </div>
      </div>
    </section>
  );
}
