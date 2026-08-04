import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { resolveOrgTimezone } from "@/lib/org-timezone";

/** Sticky org IANA timezone, or UTC when unset / invalid (server-safe). */
export async function getOrgTimezoneServer(organizationId: string): Promise<string> {
  const org = await getOrganizationServer(organizationId);
  return resolveOrgTimezone(org?.settings.timezone, { fallback: "UTC" });
}
