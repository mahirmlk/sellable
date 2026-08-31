import { type ActorType } from "@/lib/types/domain";

const actorConfig: Record<ActorType, { label: string; color: string }> = {
  buyer_agent: { label: "BUYER AGENT", color: "text-blue-400" },
  seller_agent: { label: "SELLER AGENT", color: "text-[var(--bb-orange)]" },
  policy_engine: { label: "POLICY ENGINE", color: "text-yellow-400" },
  human: { label: "HUMAN", color: "text-green-400" },
  razorpay: { label: "RAZORPAY", color: "text-purple-400" },
  system: { label: "SYSTEM", color: "text-[var(--bb-grey-2)]" },
};

export function ActorBadge({ actor }: { actor: ActorType }) {
  const cfg = actorConfig[actor] || actorConfig.system;
  return (
    <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

export function ActorIcon({ actor }: { actor: ActorType }) {
  const cfg = actorConfig[actor] || actorConfig.system;
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 text-[0.55rem] font-[var(--font-mono)] border border-current rounded-sm ${cfg.color}`}>
      {actor === "buyer_agent" ? "B" : actor === "seller_agent" ? "S" : actor === "policy_engine" ? "P" : actor === "human" ? "H" : actor === "razorpay" ? "R" : "Y"}
    </span>
  );
}
