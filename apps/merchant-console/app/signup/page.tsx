import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create account",
  description: "Set up your store to open the merchant console.",
};

// Auth removed: the dashboard opens directly. Old bookmarks land here.
export default function SignupPage() {
  redirect("/dashboard");
}
