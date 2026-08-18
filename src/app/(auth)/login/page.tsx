import { redirect } from "next/navigation";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import LoginClient from "./login-client";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

/** P5.5: Clerk is the sole web login when the flag is on. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isClerkAuthV1Enabled()) {
    const q = await searchParams;
    const next = new URLSearchParams();
    for (const key of ["next", "invite", "join", "reset"] as const) {
      const val = firstString(q[key]);
      if (val) next.set(key, val);
    }
    const qs = next.toString();
    redirect(qs ? `/sign-in?${qs}` : "/sign-in");
  }
  return <LoginClient />;
}
