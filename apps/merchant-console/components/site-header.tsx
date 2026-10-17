"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, X } from "lucide-react";

const navLinks = [
  { label: "Platform", href: "/#platform", index: "01" },
  { label: "Console", href: "/#console", index: "02" },
  { label: "Security", href: "/#security", index: "03" },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[rgba(8,8,8,0.88)] backdrop-blur-[16px] border-b border-[var(--bb-line)] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.8)]"
          : "bg-[rgba(8,8,8,0.72)] backdrop-blur-[12px] border-b border-transparent"
      }`}
    >
      {/* hairline accent, visible once scrolled */}
      <div
        aria-hidden="true"
        className={`h-px bg-gradient-to-r from-transparent via-[var(--bb-orange)]/70 to-transparent transition-opacity duration-300 ${
          scrolled ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="page-frame h-[68px] flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-3 shrink-0 rounded-sm"
          aria-label="SELLABLE home"
        >
          <Image
            src="/sellable-logo.png"
            alt="SELLABLE"
            width={180}
            height={40}
            className="h-[28px] w-auto"
            priority
          />
        </Link>

        <nav
          className="hidden md:flex items-center gap-1 bg-[rgba(13,13,13,0.72)] px-1.5 py-1.5"
          aria-label="Main navigation"
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="group relative px-4 py-2 font-[var(--font-mono)] text-[0.66rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)] transition-colors duration-200 hover:text-[var(--bb-white)] hover:bg-white/[0.06]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2.5">
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-[40px] px-4 font-[var(--font-mono)] text-[0.66rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)] hover:text-[var(--bb-white)] transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 h-[40px] px-5 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.66rem] tracking-[0.1em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors duration-200"
          >
            Open console
            <ArrowUpRight
              size={14}
              className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
        </div>

        <button
          className="md:hidden inline-flex items-center justify-center w-[44px] h-[44px] text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] transition-colors bg-[var(--bb-panel)] cursor-pointer"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-x-0 top-[69px] bottom-0 z-50 bg-[rgba(5,5,5,0.72)] backdrop-blur-sm">
          <nav
            className="page-frame py-5 flex flex-col gap-1.5 bg-[rgba(8,8,8,0.98)] border-b border-[var(--bb-line)] shadow-[0_32px_64px_-24px_rgba(0,0,0,0.9)]"
            aria-label="Mobile navigation"
          >
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-4 px-4 py-4 text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] hover:bg-[var(--bb-panel)] transition-colors"
              >
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-orange)] tabular-nums">
                  {link.index}
                </span>
                <span className="font-[var(--font-sans)] text-[1.05rem] tracking-[-0.01em]">
                  {link.label}
                </span>
                <ArrowUpRight size={16} className="ml-auto text-[var(--bb-grey-3)]" />
              </a>
            ))}
            <div className="mt-3 pt-4 border-t border-[var(--bb-line)] grid grid-cols-2 gap-2.5 px-1">
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center h-[48px] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.68rem] tracking-[0.1em] uppercase text-[var(--bb-white)]"
              >
                Sign in
              </Link>
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center h-[48px] bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.68rem] tracking-[0.1em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors"
              >
                Open console
              </Link>
            </div>
            <p className="px-4 pt-4 pb-2 font-[var(--font-mono)] text-[0.58rem] tracking-[0.06em] text-[var(--bb-grey-3)]">
              {pathname === "/" ? "Agentic commerce infrastructure" : pathname} · policy
              decides, ledger explains
            </p>
          </nav>
        </div>
      )}
    </header>
  );
}
