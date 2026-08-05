import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { resolveOrgSendPolicy } from "@/lib/email/org-send-policy";
import { getOrgSendLedgerByDayServer } from "@/lib/email/org-send-ledger-server";
import { addUtcDayKeys, sendDayKey } from "@/lib/email/mailbox-send-quota-server";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const horizonRaw = Number(url.searchParams.get("horizonDays") ?? 60);
  const horizonDays =
    Number.isFinite(horizonRaw) && horizonRaw > 0 ? Math.min(90, Math.floor(horizonRaw)) : 60;

  const timeZone = await getOrgTimezoneServer(g.ctx.session.organizationId);
  const org = await getOrganizationServer(g.ctx.session.organizationId);
  const policy = resolveOrgSendPolicy(org?.settings.sendPolicy);
  const fromDayKey = sendDayKey(new Date(), timeZone);
  const toDayKey = addUtcDayKeys(fromDayKey, horizonDays - 1);
  const bookedByDay = await getOrgSendLedgerByDayServer({
    organizationId: g.ctx.session.organizationId,
    fromDayKey,
    toDayKey,
  });

  const remainingByDay: Record<string, number> = {};
  if (policy.dailyCeiling != null) {
    for (let key = fromDayKey; key <= toDayKey; key = addUtcDayKeys(key, 1)) {
      remainingByDay[key] = Math.max(0, policy.dailyCeiling - (bookedByDay[key] ?? 0));
    }
  }

  return NextResponse.json({
    ok: true,
    timeZone,
    ceiling: policy.dailyCeiling,
    fromDayKey,
    toDayKey,
    bookedByDay,
    remainingByDay,
    sendPolicy: policy,
  });
}
