import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import {
  addUtcDayKeys,
  countPendingScheduledByUtcDayServer,
  getMailboxSendCountForDayServer,
  sendDayKey,
} from "@/lib/email/mailbox-send-quota-server";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import {
  buildMailboxUtilizationRow,
  type MailboxUtilizationRow,
} from "@/lib/email/mailbox-utilization";

function memberRoot(orgId: string, uid: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid);
}

function parseDailySendLimit(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseAssignedUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
}

type LiteMailbox = {
  id: string;
  ownerUid: string;
  label: string;
  emailAddress: string;
  enabled: boolean;
  dailySendLimit: number | null;
  assignedUserIds: string[];
};

async function listLiteMailboxesForMember(input: {
  organizationId: string;
  uid: string;
}): Promise<LiteMailbox[]> {
  const root = memberRoot(input.organizationId, input.uid);
  if (!root) return [];
  const snap = await root.collection("emailMailboxes").get();
  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const label = String(data.label ?? data.displayName ?? data.emailAddress ?? "Mailbox");
    return {
      id: doc.id,
      ownerUid: input.uid,
      label,
      emailAddress: String(data.emailAddress ?? ""),
      enabled: data.enabled !== false,
      dailySendLimit: parseDailySendLimit(data.dailySendLimit),
      assignedUserIds: parseAssignedUserIds(data.assignedUserIds),
    };
  });
}

async function sumSendStatsForDays(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  dayKeys: string[];
}): Promise<{ byDay: Record<string, number>; total: number }> {
  const db = getAdminDb();
  const byDay: Record<string, number> = {};
  let total = 0;
  if (!db || input.dayKeys.length === 0) return { byDay, total };

  const refs = input.dayKeys.map((dayKey) =>
    db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.members)
      .doc(input.uid)
      .collection("emailMailboxes")
      .doc(input.mailboxId)
      .collection("sendStats")
      .doc(dayKey),
  );

  for (let i = 0; i < refs.length; i += 100) {
    const chunk = refs.slice(i, i + 100);
    const snaps = await db.getAll(...chunk);
    for (let j = 0; j < snaps.length; j++) {
      const snap = snaps[j]!;
      const dayKey = input.dayKeys[i + j]!;
      const count = snap.exists
        ? Math.max(0, Number((snap.data() as Record<string, unknown>).count ?? 0))
        : 0;
      byDay[dayKey] = count;
      total += count;
    }
  }

  return { byDay, total };
}

/**
 * Org-wide mailbox capacity utilization for owners/managers.
 * Uses sendStats (durable) + pending scheduled counts - no IMAP secrets loaded.
 */
export async function buildOrgMailboxUtilizationServer(input: {
  organizationId: string;
}): Promise<MailboxUtilizationRow[]> {
  const users = await listOrgUsersServer(input.organizationId);
  const timeZone = await getOrgTimezoneServer(input.organizationId);
  const todayKey = sendDayKey(new Date(), timeZone);
  const weekDayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    weekDayKeys.push(addUtcDayKeys(todayKey, -i));
  }
  const pendingToDayKey = addUtcDayKeys(todayKey, 6);

  const rows: MailboxUtilizationRow[] = [];
  /**
   * Keep utilization fan-out low: every document-store read opens an interactive
   * Prisma transaction. Parallel member×mailbox work saturates PG_POOL_MAX and
   * surfaces as "Unable to start a transaction in the given time" (500s).
   */
  const MEMBER_CONCURRENCY = 1;

  async function buildForUser(user: { id: string }) {
    const mailboxes = await listLiteMailboxesForMember({
      organizationId: input.organizationId,
      uid: user.id,
    });
    if (mailboxes.length === 0) return;

    for (const mb of mailboxes) {
      const { byDay, total: sentWeek } = await sumSendStatsForDays({
        organizationId: input.organizationId,
        uid: user.id,
        mailboxId: mb.id,
        dayKeys: weekDayKeys,
      });
      const pendingByDay = await countPendingScheduledByUtcDayServer({
        organizationId: input.organizationId,
        uid: user.id,
        mailboxId: mb.id,
        fromDayKey: todayKey,
        toDayKey: pendingToDayKey,
        timeZone,
      });

      const sentToday =
        byDay[todayKey] ??
        (await getMailboxSendCountForDayServer({
          organizationId: input.organizationId,
          uid: user.id,
          mailboxId: mb.id,
          dayKey: todayKey,
          timeZone,
        }));

      const pendingToday = pendingByDay[todayKey] ?? 0;
      let pendingWeek = 0;
      for (const v of Object.values(pendingByDay)) pendingWeek += v;

      rows.push(
        buildMailboxUtilizationRow({
          mailboxId: mb.id,
          ownerUid: mb.ownerUid,
          label: mb.label,
          emailAddress: mb.emailAddress,
          enabled: mb.enabled,
          dailySendLimit: mb.dailySendLimit,
          assignedUserIds: mb.assignedUserIds,
          sentToday,
          sentWeek,
          pendingToday,
          pendingWeek,
        }),
      );
    }
  }

  // Cap parallelism so utilization does not starve the shared Prisma pg pool.
  for (let i = 0; i < users.length; i += MEMBER_CONCURRENCY) {
    const batch = users.slice(i, i + MEMBER_CONCURRENCY);
    await Promise.all(batch.map((user) => buildForUser(user)));
  }

  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}
