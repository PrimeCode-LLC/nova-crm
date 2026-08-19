import { redirect } from "next/navigation";

/** P7: Firebase password reset removed — Clerk handles forgot-password. */
export default function ResetPasswordPage() {
  redirect("/sign-in");
}
