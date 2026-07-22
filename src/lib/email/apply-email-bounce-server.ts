import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { cancelScheduledEmailServer } from "@/lib/email/scheduled-emails-server";
import {
  BOUNCE_PAUSE_REASON,
  BOUNCE_REVIEW_TASK_TITLE,
  bounceEventDocId,
  type BounceKind,
} from "@/lib/email/detect-hard-bounce";
import { stripUndefined } from "@/lib/firestore/strip-undefined";

export type ApplyEmailBounceInput = {
  organizationId: string;
  actorUid: string;
  /** Mailbox data owner (secrets / bounce ledger live under this member). */
  dataOwnerUid: string;
  mailboxId: string;
  inboundMessageId: string;
  bounceKind: BounceKind;
  failedRecipients: string[];
  originalMessageId?: string;
  reason?: string;
  subject?: string;
  /** Optional client-resolved lead id (avoids Firestore email case mismatches). */
  leadIdHint?: string;
};

export type ApplyEmailBounceResult =
  | {
      ok: true;
      alreadyProcessed?: boolean;
      skippedSoft?: boolean;
      leadId?: string;
      contactId?: string;
      taskId?: string;
      planPaused?: boolean;
      cancelledScheduled?: number;
    }
  | { ok: false; error: string; status?: number };

function bounceEventsRef(orgId: string, uid: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid)
    .collection("emailBounceEvents");
}

async function findLeadByFailedRecipient(
  organizationId: string,
  emails: string[],
): Promise<{ leadId: string; contactId: string; ownerId: string; companyName?: string; contactName?: string } | null> {
  const db = getAdminDb();
  if (!db || emails.length === 0) return null;

  for (const email of emails) {
    const leadSnap = await db
      .collection(COLLECTIONS.leads)
      .where("organizationId", "==", organizationId)
      .where("contactEmail", "==", email)
      .limit(3)
      .get();
    if (!leadSnap.empty) {
      const doc = leadSnap.docs[0]!;
      const data = doc.data();
      return {
        leadId: doc.id,
        contactId: String(data.contactId ?? ""),
        ownerId: String(data.ownerId ?? ""),
        companyName: typeof data.companyName === "string" ? data.companyName : undefined,
        contactName: typeof data.contactName === "string" ? data.contactName : undefined,
      };
    }
  }

  for (const email of emails) {
    const [byEmail, byPersonal] = await Promise.all([
      db
        .collection(COLLECTIONS.contacts)
        .where("organizationId", "==", organizationId)
        .where("email", "==", email)
        .limit(3)
        .get(),
      db
        .collection(COLLECTIONS.contacts)
        .where("organizationId", "==", organizationId)
        .where("personalEmail", "==", email)
        .limit(3)
        .get(),
    ]);
    const contactDoc = byEmail.docs[0] ?? byPersonal.docs[0];
    if (!contactDoc) continue;
    const contactId = contactDoc.id;
    const leadSnap = await db
      .collection(COLLECTIONS.leads)
      .where("organizationId", "==", organizationId)
      .where("contactId", "==", contactId)
      .limit(3)
      .get();
    if (leadSnap.empty) {
      const c = contactDoc.data();
      return {
        leadId: "",
        contactId,
        ownerId: String(c.ownerId ?? ""),
        contactName: typeof c.fullName === "string" ? c.fullName : undefined,
      };
    }
    const leadDoc = leadSnap.docs[0]!;
    const data = leadDoc.data();
    return {
      leadId: leadDoc.id,
      contactId,
      ownerId: String(data.ownerId ?? ""),
      companyName: typeof data.companyName === "string" ? data.companyName : undefined,
      contactName: typeof data.contactName === "string" ? data.contactName : undefined,
    };
  }

  return null;
}

async function findLeadByOriginalMessageId(
  organizationId: string,
  originalMessageId: string,
): Promise<{ leadId: string; contactId: string; ownerId: string; followupId?: string; companyName?: string; contactName?: string } | null> {
  const db = getAdminDb();
  if (!db) return null;
  const mid = normalizeMessageId(originalMessageId);
  if (!mid) return null;

  const snap = await db
    .collection(COLLECTIONS.followups)
    .where("organizationId", "==", organizationId)
    .where("sentMessageId", "==", mid)
    .limit(3)
    .get();
  if (snap.empty) return null;
  const f = snap.docs[0]!;
  const data = f.data();
  const leadId = typeof data.leadId === "string" ? data.leadId.trim() : "";
  if (!leadId) return null;
  const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
  if (!leadSnap.exists) {
    return {
      leadId,
      contactId: typeof data.contactId === "string" ? data.contactId : "",
      ownerId: typeof data.ownerId === "string" ? data.ownerId : "",
      followupId: f.id,
    };
  }
  const lead = leadSnap.data()!;
  return {
    leadId,
    contactId: String(lead.contactId ?? data.contactId ?? ""),
    ownerId: String(lead.ownerId ?? data.ownerId ?? ""),
    followupId: f.id,
    companyName: typeof lead.companyName === "string" ? lead.companyName : undefined,
    contactName: typeof lead.contactName === "string" ? lead.contactName : undefined,
  };
}

/**
 * Idempotently apply a hard bounce: mark contact bounced, create review task,
 * pause active follow-up plan, cancel pending scheduled sends, timeline event.
 */
export async function applyEmailBounceServer(
  input: ApplyEmailBounceInput,
): Promise<ApplyEmailBounceResult> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured", status: 503 };

  const mailboxId = input.mailboxId.trim();
  const inboundMessageId = input.inboundMessageId.trim();
  if (!mailboxId || !inboundMessageId) {
    return { ok: false, error: "mailboxId and inboundMessageId are required", status: 400 };
  }

  const eventId = bounceEventDocId(mailboxId, inboundMessageId);
  const eventsCol = bounceEventsRef(input.organizationId, input.dataOwnerUid);
  if (!eventsCol) return { ok: false, error: "Database not configured", status: 503 };

  const eventRef = eventsCol.doc(eventId);
  const existing = await eventRef.get();
  const existingData = existing.exists ? (existing.data() as Record<string, unknown>) : null;
  const existingMatched = Boolean(
    existingData &&
      (typeof existingData.leadId === "string" || typeof existingData.contactId === "string") &&
      existingData.unmatched !== true,
  );
  // Allow retry when a prior pass recorded an unmatched / empty-body attempt.
  if (existingMatched) {
    return {
      ok: true,
      alreadyProcessed: true,
      leadId: typeof existingData?.leadId === "string" ? existingData.leadId : undefined,
      contactId: typeof existingData?.contactId === "string" ? existingData.contactId : undefined,
      taskId: typeof existingData?.taskId === "string" ? existingData.taskId : undefined,
    };
  }

  const failedRecipients = [
    ...new Set(
      input.failedRecipients
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];
  const originalMessageId = input.originalMessageId
    ? normalizeMessageId(input.originalMessageId)
    : undefined;
  const reason = (input.reason?.trim() || "Permanent delivery failure").slice(0, 300);
  const now = new Date().toISOString();

  // Incomplete parse (body not synced yet) — do not write a blocking ledger entry.
  if (
    input.bounceKind === "hard" &&
    failedRecipients.length === 0 &&
    !originalMessageId
  ) {
    return {
      ok: false,
      error: "Bounce missing failed recipient; wait for body sync and retry",
      status: 409,
    };
  }

  // Soft bounces: record ledger only — do not mark contact bounced or create review tasks.
  if (input.bounceKind === "soft") {
    await eventRef.set(
      stampForCreate(
        input.organizationId,
        stripUndefined({
          mailboxId,
          inboundMessageId,
          bounceKind: "soft",
          failedRecipients,
          originalMessageId,
          reason,
          subject: input.subject?.slice(0, 300),
          actorUid: input.actorUid,
          processedAt: now,
        }),
        input.actorUid,
      ),
      { merge: true },
    );
    return { ok: true, skippedSoft: true };
  }

  let matched =
    (input.leadIdHint?.trim()
      ? await (async () => {
          const tip = input.leadIdHint!.trim();
          const leadSnap = await db.collection(COLLECTIONS.leads).doc(tip).get();
          if (!leadSnap.exists) return null;
          const data = leadSnap.data()!;
          if (String(data.organizationId ?? "") !== input.organizationId) return null;
          return {
            leadId: tip,
            contactId: String(data.contactId ?? ""),
            ownerId: String(data.ownerId ?? ""),
            companyName: typeof data.companyName === "string" ? data.companyName : undefined,
            contactName: typeof data.contactName === "string" ? data.contactName : undefined,
          };
        })()
      : null) ??
    (await findLeadByFailedRecipient(input.organizationId, failedRecipients)) ??
    (originalMessageId
      ? await findLeadByOriginalMessageId(input.organizationId, originalMessageId)
      : null);

  if (!matched || (!matched.leadId && !matched.contactId)) {
    // Keep unmatched as mergeable/retryable — do not permanently lock the bounce key.
    await eventRef.set(
      stampForCreate(
        input.organizationId,
        stripUndefined({
          mailboxId,
          inboundMessageId,
          bounceKind: "hard",
          failedRecipients,
          originalMessageId,
          reason,
          subject: input.subject?.slice(0, 300),
          actorUid: input.actorUid,
          processedAt: now,
          unmatched: true,
        }),
        input.actorUid,
      ),
      { merge: true },
    );
    return { ok: true, alreadyProcessed: false };
  }

  const contactId = matched.contactId?.trim() || "";
  const leadId = matched.leadId?.trim() || "";
  const ownerId = matched.ownerId?.trim() || input.actorUid;

  if (contactId) {
    await db
      .collection(COLLECTIONS.contacts)
      .doc(contactId)
      .update(
        stampForUpdate(
          {
            emailVerificationStatus: "bounced",
            emailVerified: false,
            emailBouncedAt: now,
          },
          input.actorUid,
        ),
      );
  }

  if (leadId) {
    await db
      .collection(COLLECTIONS.leads)
      .doc(leadId)
      .update(
        stampForUpdate(
          {
            emailVerified: false,
          },
          input.actorUid,
        ),
      );
  }

  let taskId: string | undefined;
  if (leadId) {
    taskId = `lt-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const failedList = failedRecipients.join(", ") || "unknown address";
    await db.collection(COLLECTIONS.leadTasks).doc(taskId).set(
      stampForCreate(
        input.organizationId,
        stripUndefined({
          leadId,
          title: BOUNCE_REVIEW_TASK_TITLE,
          description: `Hard bounce for ${failedList}. Reason: ${reason}. Find a valid email and resume outreach.`,
          taskType: "review",
          visibility: "on_lead",
          assigneeId: ownerId,
          createdById: input.actorUid,
          createdAt: now,
          source: "email_bounce",
          contextCompany: matched.companyName,
          contextContact: matched.contactName,
        }),
        input.actorUid,
      ),
    );
  }

  let planPaused = false;
  let cancelledScheduled = 0;
  let matchedFollowupId =
    matched && "followupId" in matched
      ? (matched as { followupId?: string }).followupId
      : undefined;

  if (leadId) {
    const plansSnap = await db
      .collection(COLLECTIONS.followupPlans)
      .where("organizationId", "==", input.organizationId)
      .where("leadId", "==", leadId)
      .where("status", "==", "active")
      .limit(5)
      .get();

    const planDocs = [...plansSnap.docs].sort((a, b) => {
      const ac = String(a.data().createdAt ?? "");
      const bc = String(b.data().createdAt ?? "");
      return bc.localeCompare(ac);
    });
    const planDoc = planDocs[0];

    if (planDoc) {
      const openSnap = await db
        .collection(COLLECTIONS.followups)
        .where("organizationId", "==", input.organizationId)
        .where("planId", "==", planDoc.id)
        .limit(50)
        .get();

      const openIds: string[] = [];
      for (const d of openSnap.docs) {
        const data = d.data();
        if (data.completedAt || data.pausedAt) continue;
        openIds.push(d.id);
        await d.ref.update(
          stampForUpdate(
            {
              pausedAt: now,
            },
            input.actorUid,
          ),
        );
      }

      await planDoc.ref.update(
        stampForUpdate(
          {
            status: "paused",
            pausedAt: now,
            pausedReason: BOUNCE_PAUSE_REASON,
            replyMessageId: `${mailboxId}:in:${inboundMessageId}`,
          },
          input.actorUid,
        ),
      );
      planPaused = true;

      const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, ownerId);
      await db.collection(COLLECTIONS.timelineEvents).add(
        stampForCreate(
          input.organizationId,
          stripUndefined({
            leadId,
            leadOwnerId: ownerId,
            leadOwnerManagerIds,
            type: "followup_plan_paused",
            actorId: input.actorUid,
            summary: `Follow-up plan paused: ${BOUNCE_PAUSE_REASON}`,
            payload: {
              planId: planDoc.id,
              bounceMessageId: `${mailboxId}:in:${inboundMessageId}`,
              openFollowupIds: openIds,
            },
            createdAt: now,
          }),
          input.actorUid,
        ),
      );
    }

    // Cancel pending scheduled emails for this lead's open followups
    const scheduledSnap = await db
      .collection(COLLECTIONS.followups)
      .where("organizationId", "==", input.organizationId)
      .where("leadId", "==", leadId)
      .limit(50)
      .get();

    for (const d of scheduledSnap.docs) {
      const data = d.data();
      if (data.completedAt) continue;
      const sid =
        typeof data.scheduledEmailId === "string" ? data.scheduledEmailId.trim() : "";
      if (!sid) continue;
      const cancel = await cancelScheduledEmailServer({
        organizationId: input.organizationId,
        uid: input.dataOwnerUid,
        id: sid,
        reason: BOUNCE_PAUSE_REASON,
      });
      if ("ok" in cancel && cancel.ok) cancelledScheduled += 1;
    }

    // Mark matching sent followup as failed when Message-ID matches
    if (originalMessageId) {
      if (!matchedFollowupId) {
        const byMid = await db
          .collection(COLLECTIONS.followups)
          .where("organizationId", "==", input.organizationId)
          .where("sentMessageId", "==", originalMessageId)
          .limit(3)
          .get();
        matchedFollowupId = byMid.docs[0]?.id;
      }
      if (matchedFollowupId) {
        await db
          .collection(COLLECTIONS.followups)
          .doc(matchedFollowupId)
          .update(
            stampForUpdate(
              {
                deliveryStatus: "failed",
                failedAt: now,
                deliveryError: `Hard bounce: ${reason}`.slice(0, 500),
                nextRetryAt: FieldValue.delete(),
              },
              input.actorUid,
            ),
          );
      }
    }

    const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, ownerId);
    await db.collection(COLLECTIONS.timelineEvents).add(
      stampForCreate(
        input.organizationId,
        stripUndefined({
          leadId,
          leadOwnerId: ownerId,
          leadOwnerManagerIds,
          type: "email_bounced",
          actorId: input.actorUid,
          summary: `Email bounced: ${failedRecipients[0] ?? "unknown"} — ${reason}`,
          payload: {
            failedRecipients,
            originalMessageId,
            bounceKind: "hard",
            mailboxId,
            inboundMessageId,
            taskId,
          },
          createdAt: now,
        }),
        input.actorUid,
      ),
    );

    if (taskId) {
      await db.collection(COLLECTIONS.timelineEvents).add(
        stampForCreate(
          input.organizationId,
          stripUndefined({
            leadId,
            leadOwnerId: ownerId,
            leadOwnerManagerIds,
            type: "lead_task_created",
            actorId: input.actorUid,
            summary: `Created task: ${BOUNCE_REVIEW_TASK_TITLE}`,
            payload: { taskId, assigneeId: ownerId, source: "email_bounce" },
            createdAt: now,
          }),
          input.actorUid,
        ),
      );
    }
  }

  await eventRef.set(
    stampForCreate(
      input.organizationId,
      stripUndefined({
        mailboxId,
        inboundMessageId,
        bounceKind: "hard",
        failedRecipients,
        originalMessageId,
        reason,
        subject: input.subject?.slice(0, 300),
        actorUid: input.actorUid,
        processedAt: now,
        leadId: leadId || undefined,
        contactId: contactId || undefined,
        taskId,
        planPaused,
        cancelledScheduled,
        unmatched: false,
      }),
      input.actorUid,
    ),
    { merge: true },
  );

  return {
    ok: true,
    leadId: leadId || undefined,
    contactId: contactId || undefined,
    taskId,
    planPaused,
    cancelledScheduled,
  };
}
