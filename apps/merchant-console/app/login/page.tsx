import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign in — SELLABLE",
};

// Auth entry points live at /sign-in and /sign-up now. Old bookmarks land here.
export default function LoginPage() {
  redirect("/sign-in");
}
