import type { Metadata } from "next";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
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
    <div className="flex min-h-screen">
      <DashboardGuard />
      <DashboardSidebar />
      <div className="flex-1 lg:ml-[240px] flex flex-col min-h-screen">
        <DashboardTopBar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
