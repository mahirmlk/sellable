"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Store as StoreIcon,
} from "lucide-react";
import {
  ApiError,
  getConsoleCatalog,
  getConsolePolicy,
  getOnboardingReadiness,
  getStore,
  onboardMerchant,
  type ConsolePolicySettings,
  type OnboardingWizardStep,
  type ReadinessView,
} from "@/lib/api";
import {
  DEMO_PREFILL,
  WIZARD_STEPS,
  defaultWizardState,
  loadWizardState,
  nextStep,
  persistWizardState,
  resolveOnboardingMode,
  stepIndex,
  type OnboardingMode,
  type WizardState,
} from "@/lib/onboarding";
import { ErrorBanner } from "@/components/dashboard/error-banner";

const INPUT =
  "w-full h-11 rounded-[12px] bg-white border border-black/[0.12] text-[15px] text-neutral-900 px-3.5 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow";
const PRIMARY =
  "inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full bg-ink text-white text-[15px] font-semibold hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.99]";
const SECONDARY =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-black/[0.14] text-[15px] font-semibold text-neutral-900 hover:bg-neutral-50 transition-colors disabled:opacity-40 cursor-pointer focus-visible:outline-2 focus-visible:outline-accent";
const LABEL = "text-[13px] text-neutral-500";
const CARD = "rounded-3xl bg-white border border-black/[0.06] shadow-card overflow-hidden";

// Checks that must pass before the store can take live orders. Everything
// else is optional setup — finishing the wizard never implies readiness.
const REQUIRED_CHECKS = new Set([
  "catalog_completeness",
  "policy_consistency",
  "payment_health",
  "webhook_health",
]);

const CHECK_LABELS: Record<string, string> = {
  catalog_completeness: "Catalog has products",
  policy_consistency: "Selling rules consistent",
  promotion_consistency: "Promotions consistent",
  payment_health: "Payment provider connected",
  webhook_health: "Payment webhooks verified",
  shipping_availability: "Shipping methods available",
  return_refund_policy_completeness: "Returns + refunds covered",
  agent_capability_profile_validity: "Agent capability profile valid",
  protocol_endpoint_health: "Agent endpoints healthy",
  sandbox_transaction: "Sandbox test transaction passed",
};

function getStepData(state: WizardState, step: OnboardingWizardStep) {
  return state.data[step] ?? {};
}

export default function OnboardingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<OnboardingMode>("production");
  const [state, setState] = useState<WizardState>(() =>
    defaultWizardState("production")
  );
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  // Live merchant context (production only; demo uses curated prefill).
  const [storeName, setStoreName] = useState<string | null>(null);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [readiness, setReadiness] = useState<ReadinessView | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = resolveOnboardingMode();
      const { state: loaded, backendAvailable: available } =
        await loadWizardState(resolved);
      if (cancelled) return;
      setMode(resolved);
      setState(loaded);
      setBackendAvailable(available);
      setLoading(false);
      if (resolved === "production") {
        // Best-effort live context; failures surface per-step, never block.
        getStore().then(
          (s) => !cancelled && setStoreName(s.name),
          () => undefined
        );
        getConsoleCatalog().then(
          (rows) => !cancelled && setCatalogCount(rows.length),
          () => undefined
        );
        getConsolePolicy().then(
          (p) => !cancelled && setPolicy(p),
          () => undefined
        );
        getOnboardingReadiness().then(
          (r) => !cancelled && setReadiness(r),
          () => undefined
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (next: WizardState, backend: boolean) => {
      const ok = await persistWizardState(mode, next, backend);
      // Backend came online (merchant just created) → flip to server persistence.
      if (!backend && mode === "production") {
        const { backendAvailable: available } = await loadWizardState(mode).catch(
          () => ({ state: next, backendAvailable: false })
        );
        if (available) {
          setBackendAvailable(true);
          await persistWizardState(mode, next, true);
        }
      }
      return ok;
    },
    [mode]
  );

  const goTo = useCallback(
    (step: OnboardingWizardStep) => {
      setState((prev) => {
        const next = { ...prev, current: step };
        void persist(next, backendAvailable);
        return next;
      });
    },
    [backendAvailable, persist]
  );

  const completeStep = useCallback(
    async (patchData?: Record<string, unknown>, createStoreName?: string) => {
      setError(null);
      setSaving(true);
      try {
        // Store step (production): a verified user without a merchant creates
        // their own store here. 409 means already onboarded — just continue.
        let backend = backendAvailable;
        if (createStoreName !== undefined && mode === "production" && storeName === null) {
          try {
            const created = await onboardMerchant(createStoreName);
            setStoreName(created.name);
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 409)) {
              throw err;
            }
            const existing = await getStore().catch(() => null);
            if (existing) setStoreName(existing.name);
          }
          backend = true;
          setBackendAvailable(true);
        }
        const current = state.current;
        const completed = state.completed.includes(current)
          ? state.completed
          : [...state.completed, current];
        const data = patchData
          ? { ...state.data, [current]: { ...getStepData(state, current), ...patchData } }
          : state.data;
        const next = nextStep(current);
        const updated: WizardState = {
          current: next ?? current,
          completed: next ? completed : [...completed],
          data,
        };
        // Finishing review marks the whole wizard complete.
        if (!next) {
          updated.completed = WIZARD_STEPS.map((s) => s.id);
          await persist(updated, backend);
          setState(updated);
          setFinished(true);
          return;
        }
        await persist(updated, backend);
        setState(updated);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.detail || "Could not save progress. Try again."
            : "Could not save progress. Try again."
        );
      } finally {
        setSaving(false);
      }
    },
    [backendAvailable, mode, persist, state, storeName]
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-canvas">
        <div className="flex items-center gap-2 text-neutral-500 text-[14px]">
          <Loader2 size={16} className="animate-spin" /> Loading setup…
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-canvas">
        <div className={`${CARD} w-full max-w-[520px] p-8 text-center space-y-4`}>
          <span className="mx-auto flex items-center justify-center size-12 rounded-full bg-green-100" aria-hidden>
            <Check size={20} className="text-green-700" />
          </span>
          <h1 className="text-[20px] font-semibold text-neutral-900">Setup complete</h1>
          <p className="text-[14px] leading-relaxed text-neutral-500">
            {mode === "demo"
              ? "Demo setup finished — explore the sample store console."
              : "Your store setup is saved. Live transactions unlock as each readiness check below passes — not before."}
          </p>
          <button onClick={() => router.push("/dashboard")} className={PRIMARY}>
            Open dashboard <ArrowRight size={15} />
          </button>
        </div>
      </div>
    );
  }

  const currentIdx = stepIndex(state.current);

  return (
    <div className="min-h-screen bg-canvas py-10 px-6">
      <div className="mx-auto w-full max-w-[720px] space-y-5">
        {mode === "demo" && (
          <div className="rounded-2xl border border-dashed border-black/[0.2] bg-amber-50/60 px-5 py-3.5 flex items-center gap-3">
            <span className="text-[11px] font-bold tracking-[0.12em] uppercase bg-ink text-white rounded-full px-2.5 py-1 shrink-0">
              Demo mode
            </span>
            <p className="text-[13px] leading-relaxed text-neutral-600">
              Sample store, prefilled. Changes stay in this demo — nothing
              touches live merchant data.{" "}
              <Link href="/sign-up" className="font-medium text-accent-strong hover:underline">
                Create a real account
              </Link>
            </p>
          </div>
        )}

        <StepIndicator
          currentIdx={currentIdx}
          completed={state.completed}
          onSelect={(id) => {
            // Free backward navigation + revisit; forward only via Continue.
            if (stepIndex(id) <= currentIdx || state.completed.includes(id)) goTo(id);
          }}
        />

        <div className={`${CARD} p-7 sm:p-8`}>
          {error && (
            <div className="mb-5">
              <ErrorBanner message={error} onRetry={() => setError(null)} />
            </div>
          )}
          <StepBody
            mode={mode}
            state={state}
            saving={saving}
            storeName={storeName}
            catalogCount={catalogCount}
            policy={policy}
            readiness={readiness}
            onContinue={completeStep}
            onBack={
              currentIdx > 0
                ? () => goTo(WIZARD_STEPS[currentIdx - 1].id)
                : null
            }
          />
        </div>

        {!backendAvailable && mode === "production" && (
          <p className="text-center text-[12px] text-neutral-400">
            Progress saves on this device until your store is created, then
            syncs to your account.
          </p>
        )}
      </div>
    </div>
  );
}

function StepIndicator({
  currentIdx,
  completed,
  onSelect,
}: {
  currentIdx: number;
  completed: OnboardingWizardStep[];
  onSelect: (id: OnboardingWizardStep) => void;
}) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Setup progress">
      {WIZARD_STEPS.map((step, i) => {
        const done = completed.includes(step.id);
        const active = i === currentIdx;
        const reachable = i <= currentIdx || done;
        return (
          <li key={step.id} className="flex-1 min-w-0">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(step.id)}
              title={`${i + 1}. ${step.title} — ${step.hint}`}
              aria-current={active ? "step" : undefined}
              className={`w-full text-left rounded-2xl px-3 py-2.5 border transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                active
                  ? "bg-white border-black/[0.14] shadow-card"
                  : done
                    ? "bg-white/60 border-black/[0.06] hover:bg-white"
                    : "bg-transparent border-transparent opacity-50"
              } ${reachable ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex items-center justify-center size-5 rounded-full text-[11px] font-semibold shrink-0 ${
                    done
                      ? "bg-green-600 text-white"
                      : active
                        ? "bg-ink text-white"
                        : "bg-black/[0.08] text-neutral-500"
                  }`}
                  aria-hidden
                >
                  {done ? <Check size={11} /> : i + 1}
                </span>
                <span className="hidden sm:block text-[12px] font-medium text-neutral-800 truncate">
                  {step.title}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function NavButtons({
  onBack,
  onContinue,
  continueLabel,
  saving,
  disableContinue,
}: {
  onBack: (() => void) | null;
  onContinue: () => void;
  continueLabel: string;
  saving: boolean;
  disableContinue?: boolean;
}) {
  return (
    <div className="mt-7 flex items-center justify-between gap-3">
      {onBack ? (
        <button type="button" onClick={onBack} className={SECONDARY}>
          <ArrowLeft size={15} /> Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onContinue}
        disabled={saving || disableContinue}
        className={PRIMARY}
      >
        {saving ? (
          <><Loader2 size={15} className="animate-spin" /> Saving…</>
        ) : (
          <>{continueLabel} <ArrowRight size={15} /></>
        )}
      </button>
    </div>
  );
}

function StepBody(props: {
  mode: OnboardingMode;
  state: WizardState;
  saving: boolean;
  storeName: string | null;
  catalogCount: number | null;
  policy: ConsolePolicySettings | null;
  readiness: ReadinessView | null;
  onContinue: (patchData?: Record<string, unknown>, createStoreName?: string) => void;
  onBack: (() => void) | null;
}) {
  switch (props.state.current) {
    case "welcome":
      return <WelcomeStep {...props} />;
    case "store":
      return <StoreStep {...props} />;
    case "catalog":
      return <CatalogStep {...props} />;
    case "rules":
      return <RulesStep {...props} />;
    case "agents":
      return <AgentsStep {...props} />;
    case "payments":
      return <PaymentsStep {...props} />;
    case "review":
      return <ReviewStep {...props} />;
  }
}

function StepHeading({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-neutral-900">
        {title}
      </h1>
      <div className="mt-1.5 text-[14px] leading-relaxed text-neutral-500">{body}</div>
    </div>
  );
}

function WelcomeStep({ state, saving, onContinue, onBack, storeName, mode }: StepProps) {
  void state;
  return (
    <div>
      <StepHeading
        title="Welcome — let's set up your store"
        body={
          <>
            {storeName
              ? <>Continuing setup for <span className="font-medium text-neutral-800">{storeName}</span>. Three things happen next: your catalog, your selling rules, and your live-sale readiness.</>
              : <>Three things happen next: your store profile, your catalog and selling rules, then a readiness review. Progress saves after every step — leave and resume anytime.</>}
            {mode === "demo" && <> You are exploring with a sample store.</>}
          </>
        }
      />
      <ul className="space-y-2.5 text-[14px] text-neutral-600">
        {[
          ["Store profile", "Name, category, region, and contact — your merchant identity."],
          ["Catalog", "Add products now, connect a source, or finish later."],
          ["Selling rules", "Order limits, discounts, negotiation bounds, approvals."],
          ["Agents", "Your Seller Agent and Customer Service Agent — no buyer agent to configure."],
          ["Payments", "What must be true before live money moves."],
        ].map(([t, d]) => (
          <li key={t} className="flex gap-3 rounded-2xl border border-black/[0.06] px-4 py-3">
            <Check size={15} className="mt-0.5 text-green-700 shrink-0" aria-hidden />
            <span><span className="font-medium text-neutral-800">{t}.</span> {d}</span>
          </li>
        ))}
      </ul>
      <NavButtons onBack={onBack} onContinue={() => onContinue({ acknowledged: true })} continueLabel="Get started" saving={saving} />
    </div>
  );
}

type StepProps = {
  mode: OnboardingMode;
  state: WizardState;
  saving: boolean;
  storeName: string | null;
  catalogCount: number | null;
  policy: ConsolePolicySettings | null;
  readiness: ReadinessView | null;
  onContinue: (patchData?: Record<string, unknown>, createStoreName?: string) => void;
  onBack: (() => void) | null;
};

function StoreStep({ mode, state, saving, onContinue, onBack, storeName }: StepProps) {
  const saved = getStepData(state, "store");
  const [name, setName] = useState<string>(
    (saved.name as string) ?? storeName ?? (mode === "demo" ? (DEMO_PREFILL.store.name as string) : "")
  );
  const [category, setCategory] = useState<string>((saved.category as string) ?? (mode === "demo" ? (DEMO_PREFILL.store.category as string) : ""));
  const [region, setRegion] = useState<string>((saved.region as string) ?? (mode === "demo" ? (DEMO_PREFILL.store.region as string) : ""));
  const [contact, setContact] = useState<string>((saved.contact as string) ?? (mode === "demo" ? (DEMO_PREFILL.store.contact as string) : ""));
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setLocalError("Store name must be at least 2 characters.");
      return;
    }
    setLocalError(null);
    onContinue({ name: trimmed, category, region, contact }, mode === "production" && storeName === null ? trimmed : undefined);
  };

  return (
    <div>
      <StepHeading
        title="Store profile"
        body={mode === "demo"
          ? "Sample values are prefilled — edit freely to explore. Nothing here touches live data."
          : storeName
            ? <>Your store <span className="font-medium text-neutral-800">{storeName}</span> exists. Review or update the profile below.</>
            : "This creates your merchant workspace — own catalog, policy, ledger, and analytics."}
      />
      <div className="space-y-4">
        {localError && <ErrorBanner message={localError} />}
        <div className="space-y-1.5">
          <label htmlFor="store-name" className={LABEL}>Store name</label>
          <input id="store-name" type="text" required minLength={2} maxLength={80} autoFocus
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Desk Supplies" className={INPUT} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="store-category" className={LABEL}>Business category</label>
            <input id="store-category" type="text" value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. home, accessories" className={INPUT} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="store-region" className={LABEL}>Region / currency</label>
            <input id="store-region" type="text" value={region} onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. IN / INR" className={INPUT} />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="store-contact" className={LABEL}>Contact email</label>
          <input id="store-contact" type="email" value={contact} onChange={(e) => setContact(e.target.value)}
            placeholder="you@company.com" className={INPUT} />
        </div>
      </div>
      <NavButtons onBack={onBack} onContinue={submit} continueLabel="Continue" saving={saving} />
    </div>
  );
}

const CATALOG_CHOICES = [
  { id: "create", title: "Add products now", body: "Create your first products in the catalog manager." },
  { id: "connect", title: "Connect a source", body: "Pull products from an existing system via connectors." },
  { id: "sample", title: "Start from examples", body: "Look at realistic examples first, replace them later." },
  { id: "later", title: "Decide later", body: "Finish setup now; catalog stays empty until you add products." },
];

function CatalogStep({ mode, state, saving, onContinue, onBack, catalogCount }: StepProps) {
  const saved = getStepData(state, "catalog");
  const [choice, setChoice] = useState<string>((saved.choice as string) ?? (mode === "demo" ? "sample" : ""));
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    if (!choice) {
      setLocalError("Choose how products get into your catalog.");
      return;
    }
    setLocalError(null);
    onContinue({ choice });
  };

  return (
    <div>
      <StepHeading
        title="Catalog setup"
        body={mode === "production" && catalogCount !== null
          ? <>Your catalog currently holds <span className="font-medium text-neutral-800">{catalogCount} product{catalogCount === 1 ? "" : "s"}</span>. Live selling needs at least one real product.</>
          : "Real mode uses your actual catalog records; demo mode starts from a curated sample catalog."}
      />
      {localError && <div className="mb-4"><ErrorBanner message={localError} /></div>}
      <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Catalog setup choice">
        {CATALOG_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={choice === c.id}
            onClick={() => setChoice(c.id)}
            className={`text-left rounded-2xl border px-4 py-3.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent ${
              choice === c.id ? "border-ink shadow-card bg-white" : "border-black/[0.08] hover:bg-white"
            }`}
          >
            <div className="flex items-center gap-2 text-[14px] font-medium text-neutral-900">
              <span className={`size-2 rounded-full ${choice === c.id ? "bg-ink" : "bg-black/15"}`} aria-hidden />
              {c.title}
            </div>
            <div className="mt-1 text-[13px] leading-relaxed text-neutral-500">{c.body}</div>
          </button>
        ))}
      </div>
      {choice === "create" && mode === "production" && (
        <Link href="/dashboard/catalog" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong hover:underline">
          Open the catalog manager <ArrowRight size={12} />
        </Link>
      )}
      {choice === "connect" && mode === "production" && (
        <Link href="/dashboard/connectors" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong hover:underline">
          Open connectors <ArrowRight size={12} />
        </Link>
      )}
      <NavButtons onBack={onBack} onContinue={submit} continueLabel="Continue" saving={saving} />
    </div>
  );
}

function RulesStep({ mode, state, saving, onContinue, onBack, policy }: StepProps) {
  const saved = getStepData(state, "rules");
  const demoRules = (mode === "demo" ? { ...DEMO_PREFILL.rules, ...saved } : saved) as Record<string, number>;
  const rows: Array<[string, string]> = policy
    ? [
        ["Max order value", `₹${Math.round(policy.max_order_value_paise / 100).toLocaleString("en-IN")}`],
        ["Max discount", `${policy.max_discount_percent}%`],
        ["Negotiation rounds", String(policy.max_negotiation_rounds)],
        ["Approval threshold", `₹${Math.round(policy.human_approval_threshold_paise / 100).toLocaleString("en-IN")}`],
      ]
    : [
        ["Max order value", `₹${Number(demoRules.maxOrderRupees ?? 5000).toLocaleString("en-IN")}`],
        ["Max discount", `${demoRules.maxDiscountPercent ?? 10}%`],
        ["Negotiation rounds", String(demoRules.negotiationRounds ?? 5)],
        ["Approval threshold", `₹${Number(demoRules.approvalThresholdRupees ?? 2000).toLocaleString("en-IN")}`],
      ];

  return (
    <div>
      <StepHeading
        title="Selling rules"
        body={mode === "demo"
          ? "Plausible editable examples, stored only in this demo. The same limits are enforced by the policy engine in production."
          : "Your current limits, enforced by the policy engine — not the browser. Tune them in Selling rules anytime."}
      />
      <dl className="rounded-2xl border border-black/[0.06] divide-y divide-black/[0.06]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-3">
            <dt className="text-[13px] text-neutral-500">{k}</dt>
            <dd className="text-[14px] font-medium text-neutral-900 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {mode === "production" && (
        <Link href="/dashboard/selling-rules" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong hover:underline">
          Open full selling rules <ArrowRight size={12} />
        </Link>
      )}
      <NavButtons onBack={onBack} onContinue={() => onContinue({ reviewed: true })} continueLabel="Continue" saving={saving} />
    </div>
  );
}

function AgentsStep({ mode, state, saving, onContinue, onBack }: StepProps) {
  void state;
  return (
    <div>
      <StepHeading
        title="Seller and service agents"
        body="Two merchant-side agents work your store. SELLABLE hosts no buyer agent — external shopping agents connect as clients through the agent gateway."
      />
      <ul className="space-y-2.5 text-[14px] text-neutral-600">
        <li className="rounded-2xl border border-black/[0.06] px-4 py-3">
          <span className="font-medium text-neutral-800">Seller Agent.</span> Product help, search and
          recommendations, carts and quotes, negotiation inside your rules, checkout assistance.
        </li>
        <li className="rounded-2xl border border-black/[0.06] px-4 py-3">
          <span className="font-medium text-neutral-800">Customer Service Agent.</span> Authenticated
          order help, shipping status, returns and bounded refund asks, escalation to humans.
        </li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        <Link href="/dashboard/chat" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong hover:underline">
          Talk to the seller <ArrowRight size={12} />
        </Link>
        <Link href="/dashboard/support" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong hover:underline">
          See support cases <ArrowRight size={12} />
        </Link>
      </div>
      {mode === "demo" && (
        <p className="mt-3 text-[12px] text-neutral-400">Demo conversations run against the sample catalog.</p>
      )}
      <NavButtons onBack={onBack} onContinue={() => onContinue({ reviewed: true })} continueLabel="Continue" saving={saving} />
    </div>
  );
}

function PaymentsStep({ mode, saving, onContinue, onBack, readiness }: StepProps) {
  const paymentOk = readiness ? Boolean(readiness.checks.payment_health) : null;
  const webhookOk = readiness ? Boolean(readiness.checks.webhook_health) : null;
  return (
    <div>
      <StepHeading
        title="Payments and fulfillment"
        body={mode === "demo"
          ? "Demo uses non-live examples and sandbox-only behavior. No real provider is connected and no money can move."
          : "Live sales need a connected provider plus verified webhooks. Save progress now and connect later — unfinished checks only block live transactions, never setup."}
      />
      {mode === "production" ? (
        <dl className="rounded-2xl border border-black/[0.06] divide-y divide-black/[0.06]">
          <StatusRow label="Payment provider" ok={paymentOk} hint="Configured server-side, never in the browser" />
          <StatusRow label="Webhook verification" ok={webhookOk} hint="Provider callbacks must verify before orders settle" />
        </dl>
      ) : (
        <div className="rounded-2xl border border-dashed border-black/[0.16] bg-amber-50/50 px-4 py-3.5 text-[13px] leading-relaxed text-neutral-600">
          Sandbox illustration: provider screens and connection statuses in the demo are
          illustrative — they never represent a real provider account.
        </div>
      )}
      <NavButtons onBack={onBack} onContinue={() => onContinue({ reviewed: true })} continueLabel="Continue" saving={saving} />
    </div>
  );
}

function StatusRow({ label, ok, hint }: { label: string; ok: boolean | null; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <dt className="text-[13px] text-neutral-700 font-medium">{label}</dt>
        <dd className="text-[12px] text-neutral-400">{hint}</dd>
      </div>
      <span
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${
          ok === null ? "bg-black/[0.05] text-neutral-500" : ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
        }`}
      >
        <span className={`size-1.5 rounded-full ${ok === null ? "bg-neutral-400" : ok ? "bg-green-600" : "bg-amber-600"}`} aria-hidden />
        {ok === null ? "Unknown" : ok ? "Ready" : "Not yet"}
      </span>
    </div>
  );
}

function ReviewStep({ mode, saving, onContinue, onBack, readiness, storeName, state }: StepProps) {
  const checks = readiness?.checks ?? {};
  const entries = Object.entries(CHECK_LABELS);
  const blockers = readiness?.live_blockers ?? [...REQUIRED_CHECKS].filter((c) => !checks[c]);
  const passedRequired = REQUIRED_CHECKS.size - blockers.length;

  return (
    <div>
      <StepHeading
        title="Review and finish"
        body={mode === "demo"
          ? "Demo integrations below are illustrative — the demo finishes regardless, and nothing here enables live orders."
          : <>Finishing setup does not make the store production-ready. Live orders unlock when the required checks pass{storeName ? <> for <span className="font-medium text-neutral-800">{storeName}</span></> : null} — currently {passedRequired} of {REQUIRED_CHECKS.size}.</>}
      />
      {mode === "production" && readiness === null && (
        <div className="mb-4"><ErrorBanner message="Readiness checks could not load. You can still finish setup — checks re-run on the dashboard." /></div>
      )}
      <ul className="rounded-2xl border border-black/[0.06] divide-y divide-black/[0.06]">
        {entries.map(([key, label]) => {
          const ok = mode === "demo" ? true : (checks[key] ?? null);
          const required = REQUIRED_CHECKS.has(key);
          return (
            <li key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`flex items-center justify-center size-5 rounded-full shrink-0 ${
                    ok === true ? "bg-green-600 text-white" : ok === false ? "bg-amber-500 text-white" : "bg-black/[0.08] text-neutral-400"
                  }`}
                  aria-hidden
                >
                  {ok === true ? <Check size={11} /> : ok === false ? "!" : "·"}
                </span>
                <span className="text-[13px] text-neutral-700 truncate">{label}</span>
                {mode === "demo" && (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400 shrink-0">illustrative</span>
                )}
              </div>
              {mode === "production" && (
                <span className={`shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 ${required ? "bg-ink/[0.06] text-ink" : "bg-black/[0.04] text-neutral-500"}`}>
                  {required ? "Required" : "Optional"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <SummaryChips state={state} mode={mode} />
      <NavButtons onBack={onBack} onContinue={() => onContinue({ finishedAt: new Date().toISOString() })} continueLabel="Finish setup" saving={saving} />
    </div>
  );
}

function SummaryChips({ state, mode }: { state: WizardState; mode: OnboardingMode }) {
  const store = getStepData(state, "store");
  const catalog = getStepData(state, "catalog");
  const chips = [
    store.name ? String(store.name) : null,
    catalog.choice ? `Catalog: ${String(catalog.choice)}` : null,
    mode === "demo" ? "Demo data" : "Live workspace",
  ].filter(Boolean) as string[];
  if (chips.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {chips.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1 text-[12px] font-medium text-neutral-700">
          <StoreIcon size={11} aria-hidden /> {c}
        </span>
      ))}
    </div>
  );
}
