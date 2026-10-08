"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/* Setup checklist — what turns the empty overview from a demo page into a
   real onboarding surface. Every step's done-state comes from loaded records
   (catalog count, payments rail, AI seller status, order count). Hidden
   entirely once all four are complete. */

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

export function GettingStarted({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  if (steps.length === 0 || doneCount === steps.length) return null;

  return (
    <Card className="shadow-card">
      <CardHeader className="flex items-center justify-between gap-3 border-b border-hairline">
        <div>
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint mb-1.5">
            Setup
          </div>
          <CardTitle className="text-[15px]">Getting started</CardTitle>
          <CardDescription className="mt-1 text-[13px]">
            Complete these steps to open your store to human and AI buyers.
          </CardDescription>
        </div>
        <span className="shrink-0 rounded-full bg-panel-2 border border-hairline px-3 py-1 text-[12px] font-medium tabular-nums text-muted">
          {doneCount} of {steps.length} done
        </span>
      </CardHeader>
      <CardContent>
        <ol className="divide-y divide-hairline">
          {steps.map((step, i) => (
            <li key={step.id} className="flex items-center gap-4 py-3.5 first:pt-1 last:pb-0">
              <span
                aria-hidden="true"
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${
                  step.done
                    ? "bg-green-600 text-white"
                    : "bg-panel-3 border border-hairline text-muted"
                }`}
              >
                {step.done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-[14px] font-medium ${step.done ? "text-muted line-through decoration-ink/20" : "text-ink"}`}
                >
                  {step.title}
                </div>
                <div className="mt-0.5 text-[13px] text-muted truncate">{step.description}</div>
              </div>
              {step.done ? (
                <span className="shrink-0 text-[12px] font-medium text-green-700">Done</span>
              ) : (
                <Link
                  href={step.href}
                  className="shrink-0 text-[13px] font-medium text-accent-strong hover:underline"
                >
                  {step.cta} →
                </Link>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
