import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { stampForCreate, stampForUpdate } from "@/lib/documents/tenant-write";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { cancelScheduledEmailServer } from "@/lib/email/scheduled-emails-server";
import {
  BOUNCE_PAUSE_REASON,
  BOUNCE_REVIEW_TASK_TITLE,
  EMAIL_EXHAUSTED_PAUSE_REASON,
  LINKEDIN_SEQUENCE_TASK_TITLE,
  bounceEventDocId,
  type BounceKind,
} from "@/lib/email/detect-hard-bounce";
import {
  resolveBounceRecoveryAction,
  resolveFailoverToEmail,
  resolveLeadLinkedIn,
  type BounceRecoveryAction,
} from "@/lib/email/bounce-recovery";
import { rerouteFollowupSequenceServer } from "@/lib/email/reroute-followup-sequence-server";
import { stripUndefined } from "@/lib/documents/strip-undefined";

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
      recoveryAction?: BounceRecoveryAction;
      failoverTo?: string;
      reroutedCount?: number;
    }
  | { ok: false; error: string; status?: number };

type MatchedLead = {
  leadId: string;
  contactId: string;
  ownerId: string;
  companyName?: string;
  contactName?: string;
  followupId?: string;
};

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
): Promise<MatchedLead | null> {
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
): Promise<MatchedLead | null> {
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

async function pauseActivePlan(input: {
  organizationId: string;
  actorUid: string;
  dataOwnerUid: string;
  leadId: string;
  ownerId: string;
  mailboxId: string;
  inboundMessageId: string;
  now: string;
  pauseReason: string;
}): Promise<{ planPaused: boolean; cancelledScheduled: number; planId?: string }> {
  const db = getAdminDb();
  if (!db) return { planPaused: false, cancelledScheduled: 0 };

  let planPaused = false;
  let cancelledScheduled = 0;
  let planId: string | undefined;

  const plansSnap = await db
    .collection(COLLECTIONS.followupPlans)
    .where("organizationId", "==", input.organizationId)
    .where("leadId", "==", input.leadId)
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
    planId = planDoc.id;
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
            pausedAt: input.now,
          },
          input.actorUid,
        ),
      );
    }

    await planDoc.ref.update(
      stampForUpdate(
        {
          status: "paused",
          pausedAt: input.now,
          pausedReason: input.pauseReason,
          replyMessageId: `${input.mailboxId}:in:${input.inboundMessageId}`,
        },
        input.actorUid,
      ),
    );
    planPaused = true;

    const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, input.ownerId);
    await db.collection(COLLECTIONS.timelineEvents).add(
      stampForCreate(
        input.organizationId,
        stripUndefined({
          leadId: input.leadId,
          leadOwnerId: input.ownerId,
          leadOwnerManagerIds,
          type: "followup_plan_paused",
          actorId: input.actorUid,
          summary: `Follow-up plan paused: ${input.pauseReason}`,
          payload: {
            planId: planDoc.id,
            bounceMessageId: `${input.mailboxId}:in:${input.inboundMessageId}`,
            openFollowupIds: openIds,
          },
          createdAt: input.now,
        }),
        input.actorUid,
      ),
    );
  }

  const scheduledSnap = await db
    .collection(COLLECTIONS.followups)
    .where("organizationId", "==", input.organizationId)
    .where("leadId", "==", input.leadId)
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
      reason: input.pauseReason,
      followupId: d.id,
    });
    if ("ok" in cancel && cancel.ok) cancelledScheduled += 1;
  }

  return { planPaused, cancelledScheduled, planId };
}

/**
 * Idempotently apply a hard bounce: mark contact bounced, recover via
 * personal-email failover / pause+fix / LinkedIn pivot, timeline event.
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
  if (existingMatched) {
    return {
      ok: true,
      alreadyProcessed: true,
      leadId: typeof existingData?.leadId === "string" ? existingData.leadId : undefined,
      contactId: typeof existingData?.contactId === "string" ? existingData.contactId : undefined,
      taskId: typeof existingData?.taskId === "string" ? existingData.taskId : undefined,
      recoveryAction:
        typeof existingData?.recoveryAction === "string"
          ? (existingData.recoveryAction as BounceRecoveryAction)
          : undefined,
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
          } satisfies MatchedLead;
        })()
      : null) ??
    (await findLeadByFailedRecipient(input.organizationId, failedRecipients)) ??
    (originalMessageId
      ? await findLeadByOriginalMessageId(input.organizationId, originalMessageId)
      : null);

  if (!matched || (!matched.leadId && !matched.contactId)) {
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

  let companyEmail: string | undefined;
  let personalEmail: string | undefined;
  let linkedin: string | undefined;
  if (contactId) {
    const contactSnap = await db.collection(COLLECTIONS.contacts).doc(contactId).get();
    if (contactSnap.exists) {
      const c = contactSnap.data()!;
      companyEmail = typeof c.email === "string" ? c.email : undefined;
      personalEmail = typeof c.personalEmail === "string" ? c.personalEmail : undefined;
      linkedin = typeof c.linkedin === "string" ? c.linkedin : undefined;
    }
  }

  let priorBounceCount = 0;
  let leadContactLinkedIn: string | undefined;
  if (leadId) {
    const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
    if (leadSnap.exists) {
      const l = leadSnap.data()!;
      priorBounceCount = Number(l.emailHardBounceCount ?? 0) || 0;
      leadContactLinkedIn =
        typeof l.contactLinkedIn === "string" ? l.contactLinkedIn : undefined;
      if (!companyEmail && typeof l.contactEmail === "string") {
        companyEmail = l.contactEmail;
      }
    }
  }

  const bounceCountAfter = priorBounceCount + 1;
  const linkedInUrl = resolveLeadLinkedIn(
    { contactLinkedIn: leadContactLinkedIn },
    { linkedin },
  );

  let recoveryAction = resolveBounceRecoveryAction({
    bounceCountAfter,
    companyEmail,
    personalEmail,
    failedRecipients,
    linkedin: linkedInUrl,
  });

  const failoverTo =
    recoveryAction === "failover_personal"
      ? resolveFailoverToEmail({ email: companyEmail, personalEmail })
      : null;
  if (recoveryAction === "failover_personal" && !failoverTo) {
    recoveryAction = "pause_fix_email";
  }

  if (contactId) {
    await db
      .collection(COLLECTIONS.contacts)
      .doc(contactId)
      .update(
        stampForUpdate(
          {
            emailVerificationStatus: "bounced",
            emailVerified: false,
            emailVerificationSource: "bounce",
            emailBouncedAt: now,
          },
          input.actorUid,
        ),
      );
  }

  if (input.bounceKind === "hard") {
    for (const email of failedRecipients) {
      void import("@/lib/email/suppression-server").then(({ addSuppression }) =>
        addSuppression({
          organizationId: input.organizationId,
          email,
          reason: "hard_bounce",
          source: "imap_bounce",
          leadId: leadId || undefined,
        }),
      );
      void import("@/lib/email/email-events-server").then(({ recordEmailEvent }) =>
        recordEmailEvent({
          organizationId: input.organizationId,
          type: "bounced",
          leadId: leadId || undefined,
          mailboxId,
          recipient: email,
          meta: { reason, inboundMessageId },
        }),
      );
    }
  }

  if (leadId) {
    const leadPatch: Record<string, unknown> = {
      emailVerified: false,
      emailVerificationStatus: "bounced",
      emailVerificationSource: "bounce",
      emailHardBounceCount: bounceCountAfter,
    };
    if (recoveryAction === "pause_linkedin" || recoveryAction === "pause_find_email") {
      leadPatch.suggestLinkedInSequence = recoveryAction === "pause_linkedin";
    }
    await db
      .collection(COLLECTIONS.leads)
      .doc(leadId)
      .update(stampForUpdate(leadPatch, input.actorUid));
  }

  let taskId: string | undefined;
  let planPaused = false;
  let cancelledScheduled = 0;
  let reroutedCount = 0;
  let matchedFollowupId =
    matched && "followupId" in matched
      ? (matched as MatchedLead).followupId
      : undefined;

  const createReviewTask = async (title: string, description: string) => {
    if (!leadId) return;
    taskId = `lt-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await db.collection(COLLECTIONS.leadTasks).doc(taskId).set(
      stampForCreate(
        input.organizationId,
        stripUndefined({
          leadId,
          title,
          description,
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
  };

  if (leadId && recoveryAction === "failover_personal" && failoverTo) {
    const reroute = await rerouteFollowupSequenceServer({
      organizationId: input.organizationId,
      actorUid: input.actorUid,
      dataOwnerUid: input.dataOwnerUid,
      leadId,
      to: failoverTo,
      mailboxId,
      reason: `Hard bounce failover to ${failoverTo}`,
    });
    if (reroute.ok) {
      cancelledScheduled = reroute.cancelledScheduled;
      reroutedCount = reroute.reroutedCount;
      const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, ownerId);
      await db.collection(COLLECTIONS.timelineEvents).add(
        stampForCreate(
          input.organizationId,
          stripUndefined({
            leadId,
            leadOwnerId: ownerId,
            leadOwnerManagerIds,
            type: "followup_plan_resumed",
            actorId: input.actorUid,
            summary: `Sequence auto-failed over to personal email (${failoverTo})`,
            payload: {
              planId: reroute.planId,
              to: failoverTo,
              reroutedCount,
              bounceMessageId: `${mailboxId}:in:${inboundMessageId}`,
            },
            createdAt: now,
          }),
          input.actorUid,
        ),
      );
    } else {
      // Fall back to pause + fix-email if queue/mailbox fails.
      recoveryAction = "pause_fix_email";
    }
  }

  if (leadId && recoveryAction !== "failover_personal") {
    const pauseReason =
      recoveryAction === "pause_linkedin" || recoveryAction === "pause_find_email"
        ? EMAIL_EXHAUSTED_PAUSE_REASON
        : BOUNCE_PAUSE_REASON;
    const paused = await pauseActivePlan({
      organizationId: input.organizationId,
      actorUid: input.actorUid,
      dataOwnerUid: input.dataOwnerUid,
      leadId,
      ownerId,
      mailboxId,
      inboundMessageId,
      now,
      pauseReason,
    });
    planPaused = paused.planPaused;
    cancelledScheduled = paused.cancelledScheduled;

    const failedList = failedRecipients.join(", ") || "unknown address";
    if (recoveryAction === "pause_linkedin") {
      await createReviewTask(
        LINKEDIN_SEQUENCE_TASK_TITLE,
        `Email bounced twice (${failedList}). Reason: ${reason}. LinkedIn profile available. Build a LinkedIn sequence to continue outreach.`,
      );
    } else if (recoveryAction === "pause_find_email") {
      await createReviewTask(
        BOUNCE_REVIEW_TASK_TITLE,
        `Email bounced twice (${failedList}). Reason: ${reason}. No LinkedIn URL on file. Find a valid email or add LinkedIn to continue.`,
      );
    } else {
      await createReviewTask(
        BOUNCE_REVIEW_TASK_TITLE,
        `Hard bounce for ${failedList}. Reason: ${reason}. Fix the email and resume the sequence (same copy) or regenerate.`,
      );
    }
  }

  if (leadId && originalMessageId) {
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

  if (leadId) {
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
          summary: `Email bounced: ${failedRecipients[0] ?? "unknown"} - ${reason}`,
          payload: {
            failedRecipients,
            originalMessageId,
            bounceKind: "hard",
            mailboxId,
            inboundMessageId,
            taskId,
            recoveryAction,
            failoverTo: failoverTo || undefined,
            bounceCountAfter,
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
            summary: `Created task: ${
              recoveryAction === "pause_linkedin"
                ? LINKEDIN_SEQUENCE_TASK_TITLE
                : BOUNCE_REVIEW_TASK_TITLE
            }`,
            payload: { taskId, assigneeId: ownerId, source: "email_bounce", recoveryAction },
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
        recoveryAction,
        failoverTo: failoverTo || undefined,
        reroutedCount: reroutedCount || undefined,
        bounceCountAfter,
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
    recoveryAction,
    failoverTo: failoverTo || undefined,
    reroutedCount: reroutedCount || undefined,
  };
}
