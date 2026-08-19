import { redirect } from "next/navigation";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

/** P7: Firebase login removed — Clerk only. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const next = new URLSearchParams();
  for (const key of ["next", "invite", "join", "reset"] as const) {
    const val = firstString(q[key]);
    if (val) next.set(key, val);
  }
  const qs = next.toString();
  redirect(qs ? `/sign-in?${qs}` : "/sign-in");
}
