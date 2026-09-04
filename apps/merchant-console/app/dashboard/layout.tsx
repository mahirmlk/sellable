import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardTopBar } from "@/components/dashboard/dashboard-topbar";
import { DashboardGuard } from "@/components/dashboard/dashboard-guard";

export const metadata: Metadata = {
  title: "SELLABLE — Merchant Dashboard",
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
