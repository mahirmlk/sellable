import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
    "aria-hidden": true,
    ...props,
  };
}

/* Overview — four-quadrant console grid with one filled cell */
export function IconOverview(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" fill="currentColor" stroke="none" />
      <rect x="9" y="1.5" width="5.5" height="5.5" />
      <rect x="1.5" y="9" width="5.5" height="5.5" />
      <rect x="9" y="9" width="5.5" height="5.5" />
    </svg>
  );
}

/* Chat — terminal prompt */
export function IconChat(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 2.5h12v9.5H6l-3 2.5v-2.5H2z" />
      <path d="M4.5 6h5M4.5 8.5h3" />
    </svg>
  );
}

/* Activity — stepped pulse line */
export function IconActivity(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3.5" />
    </svg>
  );
}

/* Transactions — stacked ledger rows */
export function IconTransactions(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 3h12M2 6.5h12M2 10h7" />
      <path d="M11 13h3" />
      <path d="M2 13h3" />
    </svg>
  );
}

/* Approvals — stamp / seal */
export function IconApprovals(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5.5 2h6v3.5a3 3 0 0 1-3 3 3 3 0 0 1-3-3z" />
      <path d="M2 13.5h12" />
      <path d="M4.5 11h7v2.5h-7z" />
      <path d="M8 8.5v2.5" />
    </svg>
  );
}

/* Catalog — archive drawer */
export function IconCatalog(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.5" y="2" width="13" height="4" />
      <rect x="2.5" y="6" width="11" height="8" />
      <path d="M6.5 9h3" />
    </svg>
  );
}

/* Growth — ascending steps */
export function IconGrowth(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 13.5h12" />
      <path d="M2.5 11l3.5-3.5 2.5 2L14 4" />
      <path d="M10.5 4H14v3.5" />
    </svg>
  );
}

/* Storefront — signal antenna (agent discovery) */
export function IconStorefront(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="6" r="1.25" fill="currentColor" stroke="none" />
      <path d="M4.5 9.5a5 5 0 0 1 0-7M11.5 2.5a5 5 0 0 1 0 7" />
      <path d="M2.5 11.5a7.8 7.8 0 0 1 11 0" opacity={0.5} />
      <path d="M8 7.5v6" />
    </svg>
  );
}

/* Settings — sliders */
export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 4.5h8M12.5 4.5H14M2 11.5h3M7.5 11.5H14" />
      <circle cx="10.5" cy="4.5" r="1.75" />
      <circle cx="5.5" cy="11.5" r="1.75" />
    </svg>
  );
}

/* Sign out — door + arrow */
export function IconSignOut(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.5 2H2.5v12h4" />
      <path d="M10 5l3 3-3 3" />
      <path d="M13 8H6.5" />
    </svg>
  );
}

/* Refresh — circular arrows, square caps */
export function IconRefresh(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 1.5v3h-3" />
    </svg>
  );
}

/* Warning — sharp triangle */
export function IconWarning(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 2L14.5 13.5H1.5z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.2v.1" strokeWidth={1.75} />
    </svg>
  );
}

/* Shield — policy */
export function IconShield(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 1.5L13.5 3.5v4c0 3.5-2.5 5.5-5.5 7-3-1.5-5.5-3.5-5.5-7v-4z" />
      <path d="M5.5 7.5L7.5 9l3-3" />
    </svg>
  );
}

/* Send — paper plane, angular */
export function IconSend(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14 2L7 9" />
      <path d="M14 2L9.5 14l-2.5-5L2 6.5z" />
    </svg>
  );
}
