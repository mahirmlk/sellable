// Shared multi-page onboarding model (UPDATE.md §5).
//
// One step sequence, two execution modes. The mode selects ONLY the data
// adapter, initial values, persistence, and allowed side effects — page
// structure, components, step indicators, and validation are identical.
//
// - production: reads/writes the authenticated merchant's tenant via
//   GET/PUT /console/onboarding/progress (plus catalog/policy/readiness
//   endpoints for live values). No merchant yet → keeps state locally
//   until the store step creates one, then pushes it to the backend.
// - demo: curated prefill + localStorage only. Never calls production
//   write APIs (Phase 3 replaces this with the isolated demo adapter).

import {
  getOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingWizardProgress,
  type OnboardingWizardStep,
} from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DEMO_COOKIE } from "@/lib/demo/cookie";

export type OnboardingMode = "production" | "demo";

export function resolveOnboardingMode(): OnboardingMode {
  if (typeof document !== "undefined") {
    const hasDemo = document.cookie
      .split(";")
      .some((part) => part.trim().startsWith(`${DEMO_COOKIE}=`));
    if (hasDemo) return "demo";
  }
  return isSupabaseConfigured() ? "production" : "demo";
}

export interface WizardStepDef {
  id: OnboardingWizardStep;
  title: string;
  hint: string;
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { id: "welcome", title: "Welcome", hint: "What SELLABLE sets up" },
  { id: "store", title: "Store profile", hint: "Name, category, region" },
  { id: "catalog", title: "Catalog", hint: "How products get in" },
  { id: "rules", title: "Selling rules", hint: "Limits + approvals" },
  { id: "agents", title: "Agents", hint: "Seller + service" },
  { id: "payments", title: "Payments", hint: "Live-sale readiness" },
  { id: "review", title: "Review", hint: "Checks + finish" },
];

export const FIRST_STEP: OnboardingWizardStep = "welcome";

export function isWizardStep(value: unknown): value is OnboardingWizardStep {
  return WIZARD_STEPS.some((s) => s.id === value);
}

export interface WizardState {
  current: OnboardingWizardStep;
  completed: OnboardingWizardStep[];
  data: Record<string, Record<string, unknown>>;
}

// --- Demo prefill: coherent, realistic sample values (editable) ---

export const DEMO_PREFILL: Record<string, Record<string, unknown>> = {
  store: {
    name: "Maple & Main Home Goods",
    category: "home",
    region: "IN",
    currency: "INR",
    contact: "hello@mapleandmain.example",
  },
  catalog: { choice: "sample" },
  rules: {
    maxOrderRupees: 5000,
    maxDiscountPercent: 10,
    negotiationRounds: 5,
    approvalThresholdRupees: 2000,
  },
  agents: { sellerEnabled: true, serviceEnabled: true },
  payments: { choice: "sandbox" },
};

const DEMO_STORAGE_KEY = "sellable_demo_onboarding_v1";

export function defaultWizardState(mode: OnboardingMode): WizardState {
  return {
    current: FIRST_STEP,
    completed: [],
    data: mode === "demo" ? structuredClone(DEMO_PREFILL) : {},
  };
}

function sanitizeState(raw: unknown, mode: OnboardingMode): WizardState {
  const fallback = defaultWizardState(mode);
  if (typeof raw !== "object" || raw === null) return fallback;
  const obj = raw as Record<string, unknown>;
  const current = isWizardStep(obj.current) ? obj.current : FIRST_STEP;
  const completed = Array.isArray(obj.completed)
    ? obj.completed.filter(isWizardStep)
    : [];
  const data =
    typeof obj.data === "object" && obj.data !== null
      ? (obj.data as Record<string, Record<string, unknown>>)
      : fallback.data;
  return {
    current,
    completed,
    data: mode === "demo" ? { ...structuredClone(DEMO_PREFILL), ...data } : data,
  };
}

// --- Persistence adapters ---

export async function loadWizardState(mode: OnboardingMode): Promise<{
  state: WizardState;
  backendAvailable: boolean;
}> {
  if (mode === "demo") {
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) return { state: sanitizeState(JSON.parse(raw), mode), backendAvailable: false };
    } catch {
      // Corrupt demo storage → start fresh, never crash onboarding.
    }
    return { state: defaultWizardState(mode), backendAvailable: false };
  }
  try {
    const progress: OnboardingWizardProgress = await getOnboardingProgress();
    return {
      state: sanitizeState(
        {
          current: progress.current_step,
          completed: progress.completed_steps,
          data: progress.data,
        },
        mode
      ),
      backendAvailable: true,
    };
  } catch {
    // No merchant yet (onboarding_required) or backend down: keep state
    // locally until the store step creates the merchant.
    return { state: defaultWizardState(mode), backendAvailable: false };
  }
}

export async function persistWizardState(
  mode: OnboardingMode,
  state: WizardState,
  backendAvailable: boolean
): Promise<boolean> {
  if (mode === "demo") {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full/blocked → session-only progress, still resumable.
    }
    return false;
  }
  if (!backendAvailable) return false;
  try {
    await saveOnboardingProgress({
      current_step: state.current,
      completed_steps: state.completed,
      data: state.data,
    });
    return true;
  } catch {
    return false;
  }
}

export function stepIndex(id: OnboardingWizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

export function nextStep(id: OnboardingWizardStep): OnboardingWizardStep | null {
  const i = stepIndex(id);
  return i >= 0 && i + 1 < WIZARD_STEPS.length ? WIZARD_STEPS[i + 1].id : null;
}
