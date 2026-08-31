type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
  hint?: string;
};

type FooterColumn = {
  heading: string;
  links: FooterLink[];
};

// All links below map to routes/endpoints that actually exist in the repo.
// Product anchors (#platform, #how-it-works) are on the landing page.
// Console routes exist under app/dashboard/[activity|transactions|approvals|catalog|growth|settings|storefront].
// Discovery endpoints (/.well-known/agents.json etc.) are served by the FastAPI backend (services/commerce/sellable/main.py).
// GitHub / Razorpay docs are public external references.
const footerColumns: FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#platform", hint: "Trust & safety capabilities" },
      { label: "How it works", href: "#how-it-works", hint: "Discovery → Pay lifecycle" },
      { label: "Live Catalog", href: "/dashboard/catalog", hint: "Merchant catalog management" },
      { label: "Growth Insights", href: "/dashboard/growth", hint: "Revenue & agent analytics" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Agents Manifest", href: "/.well-known/agents.json", external: true, hint: "GET /.well-known/agents.json" },
      { label: "LLMs.txt", href: "/llms.txt", external: true, hint: "GET /llms.txt" },
      { label: "Machine Catalog", href: "/catalog.ai.json", external: true, hint: "GET /catalog.ai.json" },
      { label: "Health", href: "/health", external: true, hint: "GET /health — environment & Razorpay status" },
      { label: "API Reference", href: "https://github.com/mahirmlk/sellable/blob/main/docs/API.md", external: true, hint: "Full API docs" },
      { label: "Architecture", href: "https://github.com/mahirmlk/sellable/blob/main/ARCHITECTURE.md", external: true, hint: "System design" },
    ],
  },
  {
    heading: "Console",
    links: [
      { label: "Dashboard", href: "/dashboard", hint: "Merchant home" },
      { label: "Transactions", href: "/dashboard/transactions", hint: "Order state & quotes" },
      { label: "Activity Ledger", href: "/dashboard/activity", hint: "XAI audit trail" },
      { label: "Approvals", href: "/dashboard/approvals", hint: "Human-in-the-loop queue" },
      { label: "Policy Settings", href: "/dashboard/settings", hint: "Guardrails & thresholds" },
      { label: "Storefront", href: "/dashboard/storefront", hint: "Public store preview" },
    ],
  },
  {
    heading: "Project",
    links: [
      { label: "GitHub Repository", href: "https://github.com/mahirmlk/sellable", external: true, hint: "Source & releases" },
      { label: "Report an Issue", href: "https://github.com/mahirmlk/sellable/issues", external: true },
      { label: "Contact", href: "mailto:hello@sellable.dev" },
      { label: "Razorpay Test Mode", href: "https://razorpay.com/docs/payments/dashboard/test-mode/", external: true, hint: "Payment rail docs" },
      { label: "Security Policy", href: "https://github.com/mahirmlk/sellable/blob/main/SECURITY.md", external: true },
    ],
  },
];

const socialLinks = [
  {
    label: "GitHub",
    href: "https://github.com/mahirmlk/sellable",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    ),
  },
  {
    label: "X",
    href: "https://x.com/sellable_dev",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="footer overflow-hidden">

      <div className="page-frame relative">
        {/* live system line */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-6 pb-2 border-b border-[var(--bb-line)]/60">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-[pulse_1.4s_ease-in-out_infinite] shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">Ledger</span>
              <span className="font-[var(--font-mono)] text-[0.6rem] text-emerald-400">recording</span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--bb-orange)] animate-[pulse_1.6s_ease-in-out_infinite] shadow-[0_0_8px_rgba(255,105,0,0.6)]" />
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">Policy</span>
              <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-orange)]">deterministic</span>
            </span>
            <span className="hidden md:inline-flex items-center gap-2 rounded-full border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-[pulse_1.8s_ease-in-out_infinite]" />
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">Payments</span>
              <span className="font-[var(--font-mono)] text-[0.6rem] text-sky-400">Razorpay test</span>
            </span>
          </div>
          <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
            Agentic commerce · agent proposes, policy disposes
          </span>
        </div>

        <div className="footer-grid">
          {footerColumns.map((col) => (
            <div key={col.heading}>
              <h4 className="footer-heading mb-5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[var(--bb-grey-3)]" aria-hidden="true" />
                {col.heading}
              </h4>
              <ul className="list-none p-0 m-0 space-y-1">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      title={link.hint}
                      className="footer-link group inline-flex items-center gap-1.5 hover:translate-x-0.5 transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bb-orange)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                    >
                      <span className="transition-colors duration-200 group-hover:text-[var(--bb-white)]">{link.label}</span>
                      <span className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 text-[var(--bb-grey-3)] group-hover:text-[var(--bb-orange)]" aria-hidden="true">
                        ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar — real values only, no fake "Soon" */}
        <div className="footer-bottom">
          <p className="footer-bottom-text">
            &copy; {year} SELLABLE. Agentic commerce infrastructure. Every money action is audit-logged.
          </p>
          <div className="footer-bottom-links">
            <a
              href="https://github.com/mahirmlk/sellable/blob/main/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-bottom-link hover:text-[var(--bb-white)]"
            >
              Docs
            </a>
            <a
              href="/health"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-bottom-link hover:text-[var(--bb-white)]"
              title="GET /health"
            >
              API Status
            </a>
            <a href="mailto:hello@sellable.dev" className="footer-bottom-link hover:text-[var(--bb-white)]">
              hello@sellable.dev
            </a>
          </div>
          <div className="footer-social">
            {socialLinks.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${social.label} (opens in new tab)`}
                className="footer-social-icon w-9 h-9 inline-flex items-center justify-center rounded-full border border-transparent hover:border-[var(--bb-line)] hover:bg-[var(--bb-panel)] hover:text-[var(--bb-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bb-orange)] focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-all duration-200"
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>

        {/* Watermark */}
        <div className="footer-wordmark" aria-hidden="true">
          SELLABLE
        </div>
      </div>
    </footer>
  );
}
