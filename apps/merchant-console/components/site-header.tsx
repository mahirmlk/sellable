"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

const navLinks = [
  { label: "HOME", href: "/" },
  { label: "PLATFORM", href: "/#platform" },
  { label: "CONSOLE", href: "/#console" },
  { label: "SECURITY", href: "/#security" },
  { label: "CASE STUDY", href: "/case-study" },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href.startsWith("/#")) return false; // section links are never "active"
    return pathname.startsWith(href.split("#")[0]);
  };

  return (
    <header className="h-[72px] sticky top-0 z-50 bg-[rgba(8,8,8,0.96)] border-b border-[var(--bb-line)] backdrop-blur-[12px]">
      <div className="page-frame h-full flex items-center justify-between">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-3" aria-label="SELLABLE home">
          <Image
            src="/sellable-logo.png"
            alt="SELLABLE"
            width={180}
            height={40}
            className="h-[30px] w-auto"
            priority
          />
        </Link>

        {/* Center: Nav (desktop) */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
          {navLinks.map((link) => {
            const active = isActive(link.href);
            return (
              <a
                key={link.label}
                href={link.href}
                className={`relative font-[var(--font-mono)] text-[0.68rem] tracking-[0.12em] uppercase px-3 py-2 transition-colors duration-[var(--duration-fast)] ${
                  active ? "text-[var(--bb-white)]" : "text-[var(--bb-grey-1)] hover:text-[var(--bb-white)]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
                <span
                  className={`absolute left-3 right-3 bottom-[2px] h-[2px] transition-all duration-200 ${
                    active ? "bg-[var(--bb-orange)]" : "bg-transparent"
                  }`}
                />
              </a>
            );
          })}
        </nav>

        {/* Right: Actions (desktop) */}
        <div className="hidden md:flex items-center gap-2.5">
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-[40px] px-[16px] border border-[#292928] bg-transparent font-[var(--font-mono)] text-[0.68rem] tracking-[0.12em] uppercase text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] hover:border-[#444] transition-all duration-[var(--duration-fast)]"
          >
            SIGN IN
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center h-[40px] px-[16px] bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.68rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors duration-[var(--duration-fast)]"
          >
            GET STARTED
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
            {navLinks.map((link, i) => {
              const active = isActive(link.href);
              return (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 font-[var(--font-mono)] text-[0.75rem] tracking-[0.12em] uppercase py-3 px-4 transition-colors duration-[var(--duration-fast)] ${
                    active
                      ? "text-[var(--bb-white)] bg-[var(--bb-panel)] shadow-[inset_2px_0_0_0_var(--bb-orange)]"
                      : "text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] hover:bg-[var(--bb-panel)]"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="text-[0.6rem] text-[var(--bb-grey-4)] tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {link.label}
                </a>
              );
            })}
            <div className="mt-4 pt-4 border-t border-[var(--bb-line)] flex flex-col gap-3 px-4">
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center h-[44px] px-[18px] border border-[#292928] bg-transparent font-[var(--font-mono)] text-[0.7rem] tracking-[0.12em] uppercase text-[var(--bb-white-soft)] hover:text-[var(--bb-white)] hover:border-[#444] transition-all"
              >
                SIGN IN
              </Link>
              <Link
                href="/signup"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center h-[44px] px-[18px] bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.7rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors"
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
