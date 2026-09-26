import type { Metadata, Viewport } from "next";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardTopBar } from "@/components/dashboard/dashboard-topbar";
import { DashboardGuard } from "@/components/dashboard/dashboard-guard";

export const metadata: Metadata = {
  title: "SELLABLE — Merchant Dashboard",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c10" },
  ],
};

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DashboardGuard />
      <DashboardShell>
        <DashboardTopBar />
        <main className="flex-1">{children}</main>
      </DashboardShell>
    </>
  );
}
