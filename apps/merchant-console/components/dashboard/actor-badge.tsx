import { type ActorType } from "@/lib/types/domain";

const actorConfig: Record<ActorType, { label: string; color: string }> = {
  buyer_agent: { label: "BUYER AGENT", color: "text-blue-400" },
  seller_agent: { label: "SELLER AGENT", color: "text-[var(--bb-orange)]" },
  policy_engine: { label: "POLICY ENGINE", color: "text-yellow-400" },
  consent_service: { label: "CONSENT SERVICE", color: "text-cyan-400" },
  human: { label: "HUMAN", color: "text-green-400" },
  razorpay: { label: "RAZORPAY", color: "text-purple-400" },
  commerce_core: { label: "COMMERCE CORE", color: "text-[var(--bb-grey-2)]" },
};

const unknownActorConfig = { label: "UNKNOWN ACTOR", color: "text-[var(--bb-grey-2)]" };

export function ActorBadge({ actor }: { actor: ActorType }) {
  const cfg = actorConfig[actor] || unknownActorConfig;
  return (
    <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

export function ActorIcon({ actor }: { actor: ActorType }) {
  const cfg = actorConfig[actor] || unknownActorConfig;
  const glyph =
    actor === "buyer_agent" ? "B"
    : actor === "seller_agent" ? "S"
    : actor === "policy_engine" ? "P"
    : actor === "consent_service" ? "C"
    : actor === "human" ? "H"
    : actor === "razorpay" ? "R"
    : actor === "commerce_core" ? "X"
    : "·";
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 text-[0.55rem] font-[var(--font-mono)] border border-current rounded-sm ${cfg.color}`}>
      {glyph}
    </span>
  );
}
