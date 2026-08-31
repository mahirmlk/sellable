import { formatPaise } from "@/lib/formatters";

export function MoneyValue({ paise, size = "md" }: { paise: number; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "text-[0.75rem]",
    md: "text-[0.85rem]",
    lg: "text-[1.1rem]",
  };
  return (
    <span className={`font-[var(--font-mono)] ${sizeClasses[size]} text-[var(--bb-white)] tabular-nums`}>
      {formatPaise(paise)}
    </span>
  );
}
