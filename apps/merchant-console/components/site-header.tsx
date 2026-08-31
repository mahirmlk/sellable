"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Search, Menu, X } from "lucide-react";

const navLinks = [
  { label: "HOME", href: "/" },
  { label: "CATALOG", href: "/dashboard#catalog" },
  { label: "ORDERS", href: "/dashboard#orders" },
  { label: "AGENTS", href: "/#platform" },
  { label: "POLICY", href: "/dashboard#policy" },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href.split("#")[0]);
  };

  return (
    <header className="h-[84px] sticky top-0 z-50 bg-[rgba(8,8,8,0.96)] border-b border-[var(--bb-line)] backdrop-blur-[12px]">
      <div className="page-frame h-full flex items-center justify-between">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/sellable-logo.png"
            alt="SELLABLE"
            width={180}
            height={40}
            className="h-[36px] w-auto"
            priority
          />
        </Link>

        {/* Center: Nav (desktop) */}
        <nav className="hidden md:flex items-center gap-8" aria-label="Main navigation">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`font-[var(--font-mono)] text-[0.72rem] tracking-[0.11em] uppercase transition-colors duration-[var(--duration-fast)] ${
                isActive(link.href)
                  ? "text-[var(--bb-white)]"
                  : "text-[var(--bb-white-soft)] hover:text-[var(--bb-white)]"
              }`}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right: Actions (desktop) */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-[44px] px-[18px] border border-[#292928] rounded-[var(--radius-pill)] bg-transparent font-[var(--font-mono)] text-[0.72rem] tracking-[0.11em] uppercase text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] hover:border-[#444] transition-all duration-[var(--duration-fast)]"
          >
            DASHBOARD
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center h-[44px] px-[18px] rounded-[var(--radius-pill)] bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.72rem] tracking-[0.11em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors duration-[var(--duration-fast)]"
          >
            GET STARTED
          </Link>
          <Link
            href="/dashboard/catalog"
            aria-label="Search catalog"
            title="Search catalog"
            className="inline-flex items-center justify-center w-[44px] h-[44px] border border-[#292928] rounded-full bg-transparent text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[#444] hover:bg-[var(--bb-panel)] active:scale-95 transition-all duration-[var(--duration-fast)]"
          >
            <Search size={16} strokeWidth={1.5} />
          </Link>
        </div>

        {/* Mobile: Hamburger */}
        <button
          className="md:hidden inline-flex items-center justify-center w-[44px] h-[44px] text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] transition-colors bg-transparent border-0 cursor-pointer"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--bb-line)] bg-[rgba(8,8,8,0.98)] backdrop-blur-[12px]">
          <nav className="page-frame py-6 flex flex-col gap-1" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`font-[var(--font-mono)] text-[0.8rem] tracking-[0.11em] uppercase py-3 px-4 transition-colors duration-[var(--duration-fast)] ${
                  isActive(link.href)
                    ? "text-[var(--bb-white)] bg-[var(--bb-panel)]"
                    : "text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] hover:bg-[var(--bb-panel)]"
                }`}
                aria-current={isActive(link.href) ? "page" : undefined}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-4 pt-4 border-t border-[var(--bb-line)] flex flex-col gap-3 px-4">
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center h-[44px] px-[18px] border border-[#292928] rounded-[var(--radius-pill)] bg-transparent font-[var(--font-mono)] text-[0.72rem] tracking-[0.11em] uppercase text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] hover:border-[#444] transition-all"
              >
                DASHBOARD
              </Link>
              <Link
                href="/signup"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center h-[44px] px-[18px] rounded-[var(--radius-pill)] bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.72rem] tracking-[0.11em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors"
              >
                GET STARTED
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
