import { type ActorType } from "@/lib/types/domain";

const actorConfig: Record<ActorType, { label: string; dot: string; bg: string; text: string }> = {
  buyer_agent: { label: "Buyer agent", dot: "bg-blue-600", bg: "bg-blue-50", text: "text-blue-700" },
  seller_agent: { label: "Seller agent", dot: "bg-[#ff6900]", bg: "bg-[#fff4e5]", text: "text-[#b25e00]" },
  policy_engine: { label: "Policy engine", dot: "bg-amber-600", bg: "bg-amber-50", text: "text-amber-800" },
  consent_service: { label: "Consent", dot: "bg-cyan-600", bg: "bg-cyan-50", text: "text-cyan-800" },
  human: { label: "Human", dot: "bg-green-600", bg: "bg-green-50", text: "text-green-700" },
  razorpay: { label: "Razorpay", dot: "bg-purple-600", bg: "bg-purple-50", text: "text-purple-700" },
  commerce_core: { label: "Commerce core", dot: "bg-neutral-400", bg: "bg-neutral-100", text: "text-neutral-600" },
};

const unknownActorConfig = { label: "Unknown", dot: "bg-neutral-400", bg: "bg-neutral-100", text: "text-neutral-600" };

export function ActorBadge({ actor }: { actor: ActorType }) {
  const cfg = actorConfig[actor] || unknownActorConfig;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${cfg.bg} ${cfg.text}`}
      title={actor}
    >
      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
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
    <span
      className="inline-flex items-center justify-center size-6 text-[12px] font-semibold rounded-full bg-gradient-to-b from-white to-neutral-100 border border-black/10 shadow-sm text-neutral-700"
      title={cfg.label}
    >
      {glyph}
    </span>
  );
}
