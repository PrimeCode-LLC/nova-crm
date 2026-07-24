import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import {
  appendGlobalEmailFooter,
  appendMailboxSignature,
} from "@/lib/email/append-mailbox-signature";
import {
  computeRerouteDueAts,
  isReroutableFollowup,
  scheduleLocalFromDueAt,
} from "@/lib/email/bounce-recovery";
import {
  cancelScheduledEmailServer,
  createScheduledEmailServer,
} from "@/lib/email/scheduled-emails-server";
import {
  getEmailAccountMetaServer,
  getMailboxProfileServer,
} from "@/lib/email/mailbox-profiles-server";

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type RerouteFollowupSequenceServerInput = {
  organizationId: string;
  actorUid: string;
  dataOwnerUid: string;
  leadId: string;
  /** Target To address for re-queued steps. */
  to: string;
  mailboxId: string;
  /** When set, resume this paused plan; otherwise use active plan for lead. */
  planId?: string;
  /** Timeline / ledger reason. */
  reason: string;
  includeSignature?: boolean;
  includeFooter?: boolean;
};

export type RerouteFollowupSequenceServerResult =
  | {
      ok: true;
      planId: string;
      reroutedCount: number;
      cancelledScheduled: number;
      dueAts: string[];
    }
  | { ok: false; error: string; status?: number };

/**
 * Resume (if paused) a follow-up plan, recompute due dates with the standard cadence,
 * and re-queue remaining unsent steps to a new To — without regenerating copy.
 */
export async function rerouteFollowupSequenceServer(
  input: RerouteFollowupSequenceServerInput,
): Promise<RerouteFollowupSequenceServerResult> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured", status: 503 };

  const to = input.to.trim();
  if (!to.includes("@")) return { ok: false, error: "Valid recipient email required", status: 400 };

  const mailboxId = input.mailboxId.trim();
  if (!mailboxId) return { ok: false, error: "mailboxId is required", status: 400 };

  const mailbox = await getMailboxProfileServer({
    organizationId: input.organizationId,
    uid: input.dataOwnerUid,
    mailboxId,
  });
  if (!mailbox) return { ok: false, error: "Mailbox not found", status: 404 };

  const from = mailbox.emailAddress?.trim();
  if (!from) return { ok: false, error: "Mailbox has no from address", status: 400 };

  let planId = input.planId?.trim() || "";
  if (!planId) {
    const activeSnap = await db
      .collection(COLLECTIONS.followupPlans)
      .where("organizationId", "==", input.organizationId)
      .where("leadId", "==", input.leadId)
      .where("status", "==", "active")
      .limit(5)
      .get();
    const pausedSnap = await db
      .collection(COLLECTIONS.followupPlans)
      .where("organizationId", "==", input.organizationId)
      .where("leadId", "==", input.leadId)
      .where("status", "==", "paused")
      .limit(5)
      .get();
    const candidates = [...activeSnap.docs, ...pausedSnap.docs].sort((a, b) => {
      const ac = String(a.data().createdAt ?? "");
      const bc = String(b.data().createdAt ?? "");
      return bc.localeCompare(ac);
    });
    planId = candidates[0]?.id ?? "";
  }
  if (!planId) return { ok: false, error: "No follow-up plan to reroute", status: 404 };

  const planRef = db.collection(COLLECTIONS.followupPlans).doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) return { ok: false, error: "Follow-up plan not found", status: 404 };
  const planData = planSnap.data()!;
  if (String(planData.organizationId ?? "") !== input.organizationId) {
    return { ok: false, error: "Follow-up plan not found", status: 404 };
  }
  if (String(planData.leadId ?? "") !== input.leadId) {
    return { ok: false, error: "Plan does not belong to this lead", status: 400 };
  }

  const stepsSnap = await db
    .collection(COLLECTIONS.followups)
    .where("organizationId", "==", input.organizationId)
    .where("planId", "==", planId)
    .limit(50)
    .get();

  const steps = stepsSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, data: d.data() }))
    .filter((s) =>
      isReroutableFollowup({
        completedAt: typeof s.data.completedAt === "string" ? s.data.completedAt : undefined,
        sentAt: typeof s.data.sentAt === "string" ? s.data.sentAt : undefined,
        sentMessageId:
          typeof s.data.sentMessageId === "string" ? s.data.sentMessageId : undefined,
        deliveryStatus:
          typeof s.data.deliveryStatus === "string"
            ? (s.data.deliveryStatus as "sent")
            : undefined,
      }),
    )
    .sort((a, b) => String(a.data.dueAt ?? "").localeCompare(String(b.data.dueAt ?? "")));

  const now = new Date().toISOString();
  let cancelledScheduled = 0;

  for (const step of steps) {
    const sid =
      typeof step.data.scheduledEmailId === "string" ? step.data.scheduledEmailId.trim() : "";
    if (!sid) continue;
    const cancel = await cancelScheduledEmailServer({
      organizationId: input.organizationId,
      uid: input.dataOwnerUid,
      id: sid,
      reason: input.reason,
    });
    if ("ok" in cancel && cancel.ok) cancelledScheduled += 1;
  }

  const dueAts = computeRerouteDueAts(steps.length);
  const includeSignature = input.includeSignature !== false;
  const includeFooter = input.includeFooter !== false;
  const meta = includeFooter
    ? await getEmailAccountMetaServer({
        organizationId: input.organizationId,
        uid: input.dataOwnerUid,
      })
    : null;

  let reroutedCount = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const dueAt = dueAts[i]!;
    const bodyRaw =
      typeof step.data.messageBody === "string" ? step.data.messageBody : "";
    const subjectRaw =
      (typeof step.data.emailSubject === "string" && step.data.emailSubject.trim()) ||
      (typeof step.data.title === "string" ? step.data.title : "Follow-up");
    if (!bodyRaw.trim()) continue;

    let outboundBody = includeSignature
      ? appendMailboxSignature(bodyRaw, mailbox.signature)
      : bodyRaw.replace(/\s+$/u, "");
    if (includeFooter) {
      outboundBody = appendGlobalEmailFooter(outboundBody, meta?.globalEmailFooter);
    }
    const html = outboundBody
      .split("\n")
      .map((l) => `<p>${escapeHtml(l) || "<br/>"}</p>`)
      .join("");

    const local = scheduleLocalFromDueAt(dueAt, i);
    const scheduledAtIso = new Date(local).toISOString();

    const created = await createScheduledEmailServer({
      organizationId: input.organizationId,
      uid: input.dataOwnerUid,
      mailboxId,
      from,
      displayName: mailbox.displayName || undefined,
      replyTo: mailbox.replyTo || undefined,
      to,
      subject: subjectRaw.trim(),
      text: outboundBody,
      html,
      scheduledAt: scheduledAtIso,
      scheduledByUserId: input.actorUid,
      followupId: step.id,
      leadId: input.leadId,
    });
    if ("error" in created) {
      // Keep dueAt update even if queue fails for this step.
      await step.ref.update(
        stampForUpdate(
          {
            dueAt,
            pausedAt: FieldValue.delete(),
            deliveryStatus: "cancelled",
            deliveryError: created.error.slice(0, 500),
          },
          input.actorUid,
        ),
      );
      continue;
    }

    await step.ref.update(
      stampForUpdate(
        {
          dueAt,
          pausedAt: FieldValue.delete(),
          scheduledEmailId: created.id,
          emailScheduledAt: scheduledAtIso,
          deliveryStatus: "scheduled",
          failedAt: FieldValue.delete(),
          cancelledAt: FieldValue.delete(),
          deliveryError: FieldValue.delete(),
          cancelReason: FieldValue.delete(),
          nextRetryAt: FieldValue.delete(),
        },
        input.actorUid,
      ),
    );
    reroutedCount += 1;
  }

  // Resume plan
  await planRef.update(
    stampForUpdate(
      {
        status: "active",
        pausedAt: FieldValue.delete(),
        pausedReason: FieldValue.delete(),
        replyMessageId: FieldValue.delete(),
      },
      input.actorUid,
    ),
  );

  const ownerId =
    typeof planData.ownerId === "string" && planData.ownerId.trim()
      ? planData.ownerId.trim()
      : input.actorUid;
  const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, ownerId);
  await db.collection(COLLECTIONS.timelineEvents).add(
    stampForCreate(
      input.organizationId,
      stripUndefined({
        leadId: input.leadId,
        leadOwnerId: ownerId,
        leadOwnerManagerIds,
        type: "followup_sequence_rerouted",
        actorId: input.actorUid,
        summary: `Sequence rerouted to ${to}: ${reroutedCount} step(s) rescheduled`,
        payload: {
          planId,
          to,
          mailboxId,
          reroutedCount,
          cancelledScheduled,
          reason: input.reason,
        },
        createdAt: now,
      }),
      input.actorUid,
    ),
  );

  return {
    ok: true,
    planId,
    reroutedCount,
    cancelledScheduled,
    dueAts,
  };
}
