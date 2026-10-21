/**
 * Send-time enforcement of the workspace send window (QA 3.5 / SEND-06).
 * Only for workspaces that explicitly saved a send policy — workspaces that
 * never configured one keep sending at the scheduled time, as before.
 */

import { nextOrgSendWindowOpening, resolveOrgSendPolicy } from "@/lib/email/org-send-policy";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

/** When the email may go out: `null` = now; otherwise the next window opening. */
export async function sendWindowDeferUntilServer(
  organizationId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const org = await getOrganizationServer(organizationId);
  const raw = org?.settings?.sendPolicy;
  if (!raw) return null;
  const timeZone = await getOrgTimezoneServer(organizationId);
  return nextOrgSendWindowOpening(resolveOrgSendPolicy(raw), timeZone, now);
}

export function sendWindowDeferMessage(at: Date): string {
  return `Outside the workspace send window; will send at ${at.toISOString()}.`;
}
