import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isClerkAuthV1ServerEnabled } from "@/lib/auth/clerk-flags";
import { authEntryPath } from "@/lib/auth/server";

function firstString(
  v: string | string[] | undefined,
): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

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

  if (isClerkAuthV1ServerEnabled()) {
    const { userId } = await auth();
    if (userId) redirect(nextPath);
  } else {
    redirect(authEntryPath());
  }

  const entry = authEntryPath();
  redirect(`${entry}?next=${encodeURIComponent(nextPath)}`);
}
