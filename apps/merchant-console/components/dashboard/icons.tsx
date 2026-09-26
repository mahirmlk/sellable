import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/* Soft Apple-like icon set: SF Symbols style — 1.5pt rounded strokes,
   outline geometry, generous corner radii. No filled cells, no sharp
   technical shapes. */

function base({ size = 16, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

/* Search — rounded magnifier */
export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="7" cy="7" r="4.75" />
      <path d="M10.6 10.6L14 14" />
    </svg>
  );
}

/* Overview — 2x2 rounded grid (like SF square.grid.2x2) */
export function IconOverview(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="2" y="2" width="5" height="5" rx="1.6" />
      <rect x="9" y="2" width="5" height="5" rx="1.6" />
      <rect x="2" y="9" width="5" height="5" rx="1.6" />
      <rect x="9" y="9" width="5" height="5" rx="1.6" />
    </svg>
  );
}

/* Chat — rounded message bubble with tail */
export function IconChat(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H7l-3.2 2.4c-.3.2-.8 0-.8-.4z" />
    </svg>
  );
}

/* Activity — soft pulse wave */
export function IconActivity(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M1.5 8.5c1 0 1.5-.5 2.2-.5h1l1.3-3.5c.2-.5.8-.5 1 0l1.8 6 1.2-3c.1-.4.6-.6 1-.4l1 .5h2.5" />
    </svg>
  );
}

/* Orders — rounded receipt */
export function IconTransactions(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5A1.5 1.5 0 0 1 12 2.5V14l-1.5-1-1.3 1-1.2-1-1.2 1-1.3-1L4 14z" />
      <path d="M6.2 5.5h3.6M6.2 8h3.6" />
    </svg>
  );
}

/* Approvals — checkmark in a rounded seal */
export function IconApprovals(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 8.2l1.8 1.8 3.2-3.6" />
    </svg>
  );
}

/* Catalog — rounded archive box */
export function IconCatalog(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="2" y="4.5" width="12" height="8" rx="1.8" />
      <path d="M2 6.5h12" />
      <path d="M6 2.5h4" />
    </svg>
  );
}

/* Growth — axis with rising curve and arrow */
export function IconGrowth(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 2.5v11h11" />
      <path d="M4.5 11.5c2 0 2-4.5 4-4.5s1.6 2 3.2 2" />
      <path d="M10.2 8.2l1.5 1.3 2.3-2.3" />
    </svg>
  );
}

/* Storefront — rounded shop with awning */
export function IconStorefront(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 6.5c0-1 .8-1.5 1.7-1.5h7.6c.9 0 1.7.5 1.7 1.5l-.6 2.2c-.2.8-.8 1.3-1.6 1.3H4.7c-.8 0-1.4-.5-1.6-1.3z" />
      <path d="M4 10.2V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.8" />
    </svg>
  );
}

/* Settings — horizontal sliders */
export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 5h7.5M12.5 5H14M2 11h2.5M7.5 11H14" />
      <circle cx="10.8" cy="5" r="1.7" />
      <circle cx="5.2" cy="11" r="1.7" />
    </svg>
  );
}

/* Sign out — door + arrow */
export function IconSignOut(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 2.5H4a1 1 0 0 0-1 1V12.5a1 1 0 0 0 1 1h3" />
      <path d="M9.5 5l3 3-3 3" />
      <path d="M12.5 8h-6" />
    </svg>
  );
}

/* Refresh — clockwise arrow */
export function IconRefresh(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.7 1.6v2.8h-2.8" />
    </svg>
  );
}

/* Warning — rounded triangle with exclamation */
export function IconWarning(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 2.2c.4 0 .7.2.9.5L14 12c.4.7-.1 1.5-.9 1.5H3c-.8 0-1.3-.8-.9-1.5l5.1-9.3c.2-.3.5-.5.8-.5z" />
      <path d="M8 6.5v2.8" />
      <path d="M8 11.4v.1" strokeWidth={1.75} />
    </svg>
  );
}

/* Shield — rounded shield with check */
export function IconShield(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 1.8c2 .7 3.4 1.2 5 1.7v3.3c0 3.2-2.3 5.3-5 6.7-2.7-1.4-5-3.5-5-6.7V3.5c1.6-.5 3-1 5-1.7z" />
      <path d="M5.8 7.8l1.7 1.7 2.7-3" />
    </svg>
  );
}

/* Send — rounded paper plane */
export function IconSend(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.8 2.2c.3-.3.8-.2 1 .1L14 9.5c-.1.4-.6.6-1 .4L9.5 8" />
      <path d="M14.5 2.8L9.5 8l-1.7 4.6c-.2.4-.8.4-1 0L5.6 9.4 2.4 8.2c-.4-.2-.4-.8 0-1z" />
    </svg>
  );
}

/* Inventory — rounded cube */
export function IconInventory(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 2l5.6 2.9c.5.2.5.9 0 1.1L8 8.9l-5.6-2.9c-.5-.2-.5-.9 0-1.1z" />
      <path d="M2.6 6.3L8 9l5.4-2.7" />
      <path d="M2.6 9.3L8 12l5.4-2.7" opacity={0.55} />
    </svg>
  );
}

/* Buyers — two rounded person outlines */
export function IconBuyers(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="5.8" cy="5" r="2.4" />
      <path d="M1.8 13.5c0-2.4 1.8-3.9 4-3.9s4 1.5 4 3.9" />
      <circle cx="11.3" cy="6" r="1.9" opacity={0.6} />
      <path d="M10.9 9.9c1.7.3 3.3 1.6 3.3 3.6" opacity={0.6} />
    </svg>
  );
}

/* Payments — rounded card */
export function IconPayments(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.8" y="3.5" width="12.4" height="9" rx="2" />
      <path d="M1.8 6.5h12.4" />
      <path d="M4 10.5h3.5" />
    </svg>
  );
}

/* Developers — rounded angle brackets */
export function IconDevelopers(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 3.8L3 8l3 4.2" />
      <path d="M10 3.8L13 8l-3 4.2" />
    </svg>
  );
}
