import type { ComponentType } from "react";
import {
  IconOverview,
  IconCatalog,
  IconTransactions,
  IconChat,
  IconStorefront,
  IconApprovals,
  IconGrowth,
  IconActivity,
  IconSettings,
  IconShield,
  IconInventory,
  IconBuyers,
  IconPayments,
  IconDevelopers,
} from "./icons";

export type NavIcon = ComponentType<{ size?: number; className?: string }>;

export interface NavItem {
  label: string;
  href: string;
  /** Optional key other agents can map to a live count (e.g. pending approvals). */
  badgeKey?: string;
  icon: NavIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Single source of truth for merchant navigation.
 * Product language only: Orders (never Transactions), Buyers, AI Sales,
 * Selling Rules, Analytics, Live Activity, Payments, Developers.
 * Technical terms (Trace ID, Ledger, Agent Gateway) stay out of primary nav.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Home",
    items: [{ label: "Home", href: "/dashboard", icon: IconOverview }],
  },
  {
    label: "Store",
    items: [
      { label: "Products", href: "/dashboard/catalog", icon: IconCatalog },
      { label: "Inventory", href: "/dashboard/inventory", icon: IconInventory },
      {
        label: "Orders",
        href: "/dashboard/transactions",
        icon: IconTransactions,
      },
      { label: "Buyers", href: "/dashboard/buyers", icon: IconBuyers },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "AI Sales", href: "/dashboard/chat", icon: IconChat },
      { label: "AI Storefront", href: "/dashboard/storefront", icon: IconStorefront },
      { label: "Selling Rules", href: "/dashboard/selling-rules", icon: IconShield },
      {
        label: "Approvals",
        href: "/dashboard/approvals",
        badgeKey: "approvals",
        icon: IconApprovals,
      },
    ],
  },
  {
    label: "Analyze",
    items: [
      { label: "Analytics", href: "/dashboard/growth", icon: IconGrowth },
      { label: "Live Activity", href: "/dashboard/activity", icon: IconActivity },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Payments", href: "/dashboard/payments", icon: IconPayments },
      { label: "Developers", href: "/dashboard/developers", icon: IconDevelopers },
      { label: "Settings", href: "/dashboard/settings", icon: IconSettings },
    ],
  },
];

/** Flat list of every nav item — used by the command menu and sitemaps. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export type NavItemWithSection = NavItem & { section: string };

export const NAV_ITEMS_WITH_SECTION: NavItemWithSection[] = NAV_SECTIONS.flatMap(
  (s) => s.items.map((item) => ({ ...item, section: s.label }))
);
