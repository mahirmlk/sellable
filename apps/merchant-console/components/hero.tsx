"use client";

import { Eyebrow } from "./ui/eyebrow";
import { Blueprint } from "./blueprint";

export function Hero() {
  return (
    <section className="technical-section">
      <div className="page-frame">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.03fr)_minmax(0,0.97fr)] items-center gap-[clamp(32px,5vw,96px)] py-[clamp(64px,9vw,132px)]">
          {/* Left: Content */}
          <div>
            <div className="animate-slide-up">
              <Eyebrow label="AGENTIC COMMERCE INFRASTRUCTURE" />
            </div>

            <h1 className="hero-title mt-8 text-[var(--bb-white)] animate-slide-up animate-delay-1">
              The commerce layer for AI buyers
            </h1>

            <p className="body-copy mt-8 animate-slide-up animate-delay-2">
              SELLABLE makes your store discoverable, negotiable, and safely
              transactable by autonomous AI agents — with deterministic policy
              enforcement and full audit trails on every money action.
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-10 animate-slide-up animate-delay-3">
              <a href="/dashboard" className="btn-light">
                GET STARTED
              </a>
              <a href="#how-it-works" className="btn-outline">
                HOW IT WORKS
              </a>
            </div>
          </div>

          {/* Right: Blueprint */}
          <div className="animate-slide-up animate-delay-4">
            <Blueprint />
          </div>
        </div>
      </div>
    </section>
  );
}
