import { headers } from "next/headers";
import { SITE } from "@/lib/site";

/** Build an absolute origin string for invite emails / setup links. */
export async function getRequestOrigin(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${proto}://${host}`;
  } catch {
    // headers() may not be available in some contexts
  }
  return SITE.url;
}

export function inviteAcceptUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/signup?invite=${encodeURIComponent(token)}`;
}
