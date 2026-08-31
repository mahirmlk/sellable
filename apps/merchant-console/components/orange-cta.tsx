export function OrangeCTA() {
  return (
    <section className="orange-cta">
      <div className="page-frame">
        <h2>
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
          <a href="/dashboard" className="btn-orange-primary">
            START BUILDING
          </a>
          <a href="#platform" className="btn-orange-secondary">
            READ THE DOCS
          </a>
        </div>
      </div>
    </section>
  );
}
