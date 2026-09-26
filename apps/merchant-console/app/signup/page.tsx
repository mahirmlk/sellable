import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create account — SELLABLE",
};

// Auth removed: the dashboard opens directly. Old bookmarks land here.
export default function SignupPage() {
  redirect("/dashboard");
}
