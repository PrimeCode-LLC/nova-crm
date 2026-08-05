import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { addUtcDayKey } from "@/lib/email/mailbox-schedule-capacity";
import { resolveOrgTimezone, zonedDayKey } from "@/lib/org-timezone";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { resolveOrgSendPolicy } from "@/lib/email/org-send-policy";

function ledgerRef(organizationId: string, dayKey: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.sendLedger)
    .doc(dayKey);
}

class OrgSendCeilingError extends Error {
  readonly status = 429 as const;
  constructor(message: string) {
    super(message);
    this.name = "OrgSendCeilingError";
  }
}

export async function incrementOrgSendLedgerServer(input: {
  organizationId: string;
  scheduledAt: Date | string;
  delta: number;
  timeZone?: string;
}): Promise<{ ok: true; dayKey: string } | { ok: false; error: string; status: 429 }> {
  if (!input.delta) return { ok: true, dayKey: "" };
  const db = getAdminDb();
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const when =
    input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) return { ok: true, dayKey: "" };
  const dayKey = zonedDayKey(when, resolveOrgTimezone(zone));
  const ref = ledgerRef(input.organizationId, dayKey);
  if (!db || !ref) return { ok: true, dayKey };

  const org = await getOrganizationServer(input.organizationId);
  const policy = resolveOrgSendPolicy(org?.settings.sendPolicy);
  const ceiling =
    input.delta > 0 && policy.dailyCeiling != null ? policy.dailyCeiling : null;

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = Math.max(0, Number((snap.data() as { booked?: unknown } | undefined)?.booked ?? 0));
      if (ceiling != null && used + input.delta > ceiling) {
        throw new OrgSendCeilingError(
          `Organization daily send limit full for ${dayKey} (${used}/${ceiling} booked). Pick another day.`,
        );
      }
      tx.set(
        ref,
        {
          dayKey,
          booked: Math.max(0, used + input.delta),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });
  } catch (err) {
    if (err instanceof OrgSendCeilingError) {
      return { ok: false, error: err.message, status: err.status };
    }
    throw err;
  }
  return { ok: true, dayKey };
}

export async function getOrgSendLedgerByDayServer(input: {
  organizationId: string;
  fromDayKey: string;
  toDayKey: string;
}): Promise<Record<string, number>> {
  const db = getAdminDb();
  const out: Record<string, number> = {};
  if (!db) return out;
  const col = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.sendLedger);
  try {
    const snap = await col
      .where("dayKey", ">=", input.fromDayKey)
      .where("dayKey", "<=", input.toDayKey)
      .get();
    for (const doc of snap.docs) {
      const booked = Math.max(0, Number((doc.data() as Record<string, unknown>).booked ?? 0));
      out[doc.id] = booked;
    }
  } catch {
    for (let key = input.fromDayKey; key <= input.toDayKey; key = addUtcDayKey(key, 1)) {
      const snap = await col.doc(key).get();
      if (!snap.exists) continue;
      out[key] = Math.max(0, Number((snap.data() as Record<string, unknown>).booked ?? 0));
    }
  }
  return out;
}

export async function assertOrgScheduleDayCeilingServer(input: {
  organizationId: string;
  scheduledAt: Date | string;
  timeZone?: string;
}): Promise<
  | { ok: true; dayKey: string; used: number; ceiling: number | null; remaining: number | null }
  | {
      ok: false;
      error: string;
      dayKey: string;
      used: number;
      ceiling: number;
      remaining: number;
      status: 429;
    }
> {
  const org = await getOrganizationServer(input.organizationId);
  const policy = resolveOrgSendPolicy(org?.settings.sendPolicy);
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const when =
    input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
  const dayKey = zonedDayKey(when, resolveOrgTimezone(zone));
  if (policy.dailyCeiling == null) {
    return { ok: true, dayKey, used: 0, ceiling: null, remaining: null };
  }
  const byDay = await getOrgSendLedgerByDayServer({
    organizationId: input.organizationId,
    fromDayKey: dayKey,
    toDayKey: dayKey,
  });
  const used = byDay[dayKey] ?? 0;
  if (used >= policy.dailyCeiling) {
    return {
      ok: false,
      error: `Organization daily send limit full for ${dayKey} (${used}/${policy.dailyCeiling} booked). Pick another day.`,
      dayKey,
      used,
      ceiling: policy.dailyCeiling,
      remaining: 0,
      status: 429,
    };
  }
  return {
    ok: true,
    dayKey,
    used,
    ceiling: policy.dailyCeiling,
    remaining: Math.max(0, policy.dailyCeiling - used),
  };
}
