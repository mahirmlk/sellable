import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Opens your merchant console.",
};

// Auth removed: the dashboard opens directly. Old bookmarks land here.
export default function LoginPage() {
  redirect("/dashboard");
}
