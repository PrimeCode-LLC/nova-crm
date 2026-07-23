import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { isAuthDisabled } from "@/lib/auth/flags";

function firstString(
  v: string | string[] | undefined,
): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

/** Same-origin path only - blocks open redirects via callbackUrl. */
function safeInternalPath(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "/dashboard";
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.trim());
  } catch {
    return "/dashboard";
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return "/dashboard";
  const rest = decoded.slice(1);
  if (rest.startsWith("\\") || rest.toLowerCase().startsWith("%2f")) return "/dashboard";
  return decoded;
}

/**
 * Compatibility entry for tools that expect NextAuth-style `/auth?callbackUrl=...`.
 * This app signs in at `/login` using the `next` query param.
 */
export default async function AuthCompatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const nextPath = safeInternalPath(
    firstString(q.callbackUrl) ?? firstString(q.next),
  );

  if (isAuthDisabled()) {
    redirect(nextPath);
  }

  const jar = await cookies();
  if (jar.get(SESSION_COOKIE_NAME)?.value) {
    redirect(nextPath);
  }

  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
