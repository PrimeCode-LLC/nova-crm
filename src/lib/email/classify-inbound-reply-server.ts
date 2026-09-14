import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { coerceIsoInstant } from "@/lib/db/document-shim/timestamp";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/documents/tenant-write";
import { stripUndefined } from "@/lib/documents/strip-undefined";
import { AiForbiddenError, AiNotConfiguredError, runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { isLikelyAutoReply } from "@/lib/followup-plan-reply";
import { listLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import type { LeadMailUpsertInput } from "@/lib/email/lead-mail-types";
import {
  formatReplyNextAction,
  replyActionNeedsDraft,
  type ReplyAction,
  type ReplyClass,
  type ReplyRecommendedAction,
  type ClassifiedBy,
} from "@/lib/email/reply-action-types";
import { generateReplyActionDraftServer } from "@/lib/email/generate-reply-action-draft-server";
import { buildInboundReplySignalBlock } from "@/lib/email/reply-signals";
import { replyTextOnly, stripQuotedReply } from "@/lib/email/strip-quoted-reply";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import { buildReplyDetectedPatch } from "@/lib/leads/reply-review";
import { resolveWaitUntilDate } from "@/lib/email/ooo-return-date";
import type { ReplyActionCompletionOutcome } from "@/lib/leads/reply-action-completion-types";
import { resolveReplyReviewAfterReplyActionServer } from "@/lib/leads/resolve-reply-review-after-reply-action-server";

export const replyClassifySchema = z.object({
  classification: z.enum([
    "auto_reply",
    "positive",
    "meeting_ready",
    "neutral",
    "objection",
    "soft_no",
    "hard_no",
    "unsubscribe_request",
    "unclear",
  ]),
  potentialScore: z.number().min(0).max(100),
  recommendedAction: z.enum([
    "reply_now",
    "schedule_followup",
    "book_meeting",
    "nurture",
    "close_lost",
    "ignore",
    "wait",
  ]),
  rationale: z.string(),
  nextStepSummary: z.string(),
  /**
   * Calendar day (YYYY-MM-DD) to wait until before following up.
   * Empty string when no dated return / deferral is named.
   * Required for OpenAI structured outputs (no optional object fields).
   */
  waitUntilDate: z.string().max(32),
});

export function replyActionDocId(leadId: string, inboundProviderKey: string): string {
  return createHash("sha1").update(`${leadId}\0${inboundProviderKey}`).digest("hex");
}

function heuristicAutoReply(input: {
  subject: string;
  preview: string;
  bodyText: string;
  today?: string;
}): z.infer<typeof replyClassifySchema> | null {
  if (
    !isLikelyAutoReply({
      subject: input.subject,
      preview: `${input.preview} ${input.bodyText}`.slice(0, 500),
    })
  ) {
    return null;
  }
  const waitUntilDate =
    resolveWaitUntilDate({
      subject: input.subject,
      body: `${input.preview}\n${input.bodyText}`,
      today: input.today,
    }) ?? "";
  return {
    classification: "auto_reply",
    potentialScore: 10,
    recommendedAction: "wait",
    rationale: "Looks like an automatic / out-of-office reply, not a human decision.",
    nextStepSummary: waitUntilDate
      ? `Wait until ${waitUntilDate}, then follow up — do not treat this as a sales reply.`
      : "Wait for their return or follow up later — do not treat this as a sales reply.",
    waitUntilDate,
  };
}

/** Fill waitUntilDate from heuristics when the model left it blank or invalid. */
function withResolvedWaitUntil(
  result: z.infer<typeof replyClassifySchema>,
  input: { subject: string; body: string; today: string },
): z.infer<typeof replyClassifySchema> {
  const waitUntilDate =
    resolveWaitUntilDate({
      aiWaitUntilDate: result.waitUntilDate,
      subject: input.subject,
      body: input.body,
      nextStepSummary: result.nextStepSummary,
      today: input.today,
    }) ?? "";
  if (waitUntilDate === (result.waitUntilDate ?? "").trim()) return result;
  const nextStepSummary =
    result.classification === "auto_reply" &&
    waitUntilDate &&
    !/\d{4}-\d{2}-\d{2}/.test(result.nextStepSummary)
      ? `Wait until ${waitUntilDate}, then follow up — do not treat this as a sales reply.`
      : result.nextStepSummary;
  return { ...result, waitUntilDate, nextStepSummary };
}

function leadSnapshotForClassify(lead: ReturnType<typeof mapLeadDoc>): string {
  return JSON.stringify(
    {
      id: lead.id,
      stage: lead.stage,
      temperature: lead.temperature,
      companyName: lead.companyName,
      companyIndustry: lead.companyIndustry,
      companySize: lead.companySize,
      contactName: lead.contactName,
      contactTitle: lead.contactTitle,
      contactEmail: lead.contactEmail,
      channel: lead.channel,
      doNotContact: lead.doNotContact,
      nextAction: lead.nextAction,
      notes: lead.notes?.slice(0, 500),
    },
    null,
    2,
  );
}

type ThreadContext = {
  text: string;
  inboundCount: number;
  outboundCount: number;
  firstOutboundAt?: string;
  lastOutboundAt?: string;
};

async function buildThreadSnippet(input: {
  organizationId: string;
  leadId: string;
  latestProviderKey: string;
}): Promise<ThreadContext> {
  const rows = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: input.leadId,
    limit: 24,
  });
  const chronological = [...rows]
    .filter((row) => row.providerKey !== input.latestProviderKey)
    .sort((a, b) => a.date.localeCompare(b.date));

  const outbound = chronological.filter((row) => row.direction === "outbound");
  const lines: string[] = [];
  for (const row of chronological.slice(-12)) {
    const who = row.direction === "inbound" ? "THEM" : "US";
    const raw = row.bodyText || row.preview || "";
    const snippet = replyTextOnly(raw).replace(/\s+/g, " ").trim().slice(0, 400);
    lines.push(`[${who}] ${row.date} · ${row.subject}\n${snippet}`);
  }

  return {
    text: lines.length ? lines.join("\n\n") : "(no prior thread stored)",
    inboundCount: chronological.length - outbound.length,
    outboundCount: outbound.length,
    firstOutboundAt: outbound[0]?.date,
    lastOutboundAt: outbound[outbound.length - 1]?.date,
  };
}

async function writeReplyActionAndLead(input: {
  organizationId: string;
  leadId: string;
  mailboxId: string;
  mailboxOwnerUid?: string;
  inboundProviderKey: string;
  inboundPreview?: string;
  inboundFrom?: string;
  inboundSubject?: string;
  inboundMessageId?: string;
  source: ReplyAction["source"];
  result: z.infer<typeof replyClassifySchema>;
  classifiedBy: ClassifiedBy;
  actorUid?: string;
  /** When true, clear prior draft / decision fields so a manual re-run starts clean. */
  force?: boolean;
}): Promise<{ actionId: string }> {
  const db = getAdminDb();
  if (!db) return { actionId: "" };

  const now = new Date().toISOString();
  const actionId = replyActionDocId(input.leadId, input.inboundProviderKey);
  const nextAction = formatReplyNextAction({
    classification: input.result.classification,
    nextStepSummary: input.result.nextStepSummary,
    potentialScore: input.result.potentialScore,
  });

  const needsDraft = replyActionNeedsDraft({
    classification: input.result.classification as ReplyClass,
    recommendedAction: input.result.recommendedAction as ReplyRecommendedAction,
  });

  const inboundPreview = (input.inboundPreview || "").replace(/\s+/g, " ").trim().slice(0, 280);
  const inboundFrom = (input.inboundFrom || "").trim().slice(0, 200);
  const inboundSubject = (input.inboundSubject || "").trim().slice(0, 300);
  const inboundMessageId = (input.inboundMessageId || "").trim() || undefined;

  const waitUntilDate = resolveWaitUntilDate({
    aiWaitUntilDate: input.result.waitUntilDate,
    subject: inboundSubject,
    body: inboundPreview,
    nextStepSummary: input.result.nextStepSummary,
  });

  const doc: ReplyAction = {
    id: actionId,
    organizationId: input.organizationId,
    leadId: input.leadId,
    mailboxId: input.mailboxId,
    ...(input.mailboxOwnerUid ? { mailboxOwnerUid: input.mailboxOwnerUid } : {}),
    inboundProviderKey: input.inboundProviderKey,
    status: "pending",
    classification: input.result.classification as ReplyClass,
    potentialScore: Math.round(input.result.potentialScore),
    recommendedAction: input.result.recommendedAction as ReplyRecommendedAction,
    rationale: input.result.rationale.trim().slice(0, 1_000),
    nextStepSummary: input.result.nextStepSummary.trim().slice(0, 500),
    ...(waitUntilDate ? { waitUntilDate } : {}),
    ...(inboundPreview ? { inboundPreview } : {}),
    ...(inboundFrom ? { inboundFrom } : {}),
    ...(inboundSubject ? { inboundSubject } : {}),
    ...(inboundMessageId ? { draftInReplyTo: inboundMessageId } : {}),
    draftStatus: needsDraft ? "pending" : "none",
    source: input.source,
    classifiedBy: input.classifiedBy,
    createdAt: now,
    updatedAt: now,
  };

  const forceReset = input.force
    ? {
        draftSubject: FieldValue.delete(),
        draftBody: FieldValue.delete(),
        draftTo: FieldValue.delete(),
        draftError: FieldValue.delete(),
        draftReferenceIds: FieldValue.delete(),
        sentAt: FieldValue.delete(),
        sentMessageId: FieldValue.delete(),
        decidedAt: FieldValue.delete(),
        decidedBy: FieldValue.delete(),
        ...(!waitUntilDate ? { waitUntilDate: FieldValue.delete() } : {}),
      }
    : {};

  await db
    .collection(COLLECTIONS.replyActions)
    .doc(actionId)
    .set(
      {
        ...stripUndefined(doc as unknown as Record<string, unknown>),
        ...forceReset,
      },
      { merge: true },
    );

  const isAutoReply = doc.classification === "auto_reply";
  const replySource: "imap" | "instantly" | "manual" =
    input.source === "instantly" ? "instantly" : input.source === "imap" ? "imap" : "manual";

  const leadSnapForPatch = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  const leadForPatch = leadSnapForPatch.exists
    ? mapLeadDoc(leadSnapForPatch.id, leadSnapForPatch.data() as Record<string, unknown>)
    : null;

  const humanReplyPatch =
    !isAutoReply && leadForPatch
      ? buildReplyDetectedPatch({
          lead: leadForPatch,
          replyAt: now,
          replyMessageId: input.inboundProviderKey,
          source: replySource,
        })
      : null;

  await db
    .collection(COLLECTIONS.leads)
    .doc(input.leadId)
    .set(
      stripUndefined({
        pendingReplyActionId: actionId,
        replyClass: doc.classification,
        replyActionStatus: "pending",
        nextAction: needsDraft ? `${nextAction} · Draft generating…` : nextAction,
        lastActivityAt: now,
        updatedAt: now,
        ...(isAutoReply
          ? {
              lastAutoReplyAt: now,
              ...(input.inboundProviderKey
                ? { lastAutoReplyMessageId: input.inboundProviderKey }
                : {}),
              ...(waitUntilDate
                ? { followUpAfterDate: waitUntilDate }
                : {}),
            }
          : {
              ...(humanReplyPatch ?? {}),
              // Clear a stale OOO wait, unless this human deferral names a new date.
              followUpAfterDate:
                waitUntilDate &&
                (doc.recommendedAction === "schedule_followup" ||
                  doc.recommendedAction === "wait")
                  ? waitUntilDate
                  : FieldValue.delete(),
            }),
      }),
      { merge: true },
    );

  // Timeline: inbound reply classified (complete process visibility).
  try {
    const leadSnap = leadSnapForPatch.exists
      ? leadSnapForPatch
      : await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
    const rawOwner = leadSnap.data()?.ownerId;
    const leadOwnerId =
      (typeof rawOwner === "string" && rawOwner.trim()) ||
      input.mailboxOwnerUid ||
      input.actorUid ||
      "system";
    const actorId = input.actorUid?.trim() || leadOwnerId;
    const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
    const teId = `te-${crypto.randomUUID()}`;
    const timelineType = isAutoReply ? "email_auto_replied" : "email_replied";
    const timelineSummary = isAutoReply
      ? inboundSubject
        ? `Auto-reply / OOO: ${inboundSubject}`
        : "Auto-reply / out-of-office received"
      : inboundSubject
        ? `Email replied: ${inboundSubject}`
        : "Lead replied by email";
    await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
      stampForCreate(
        input.organizationId,
        {
          leadId: input.leadId,
          leadOwnerId,
          leadOwnerManagerIds,
          type: timelineType,
          actorId,
          summary: timelineSummary,
          payload: {
            source: "reply_intelligence",
            replyActionId: actionId,
            classification: doc.classification,
            potentialScore: doc.potentialScore,
            classifiedBy: input.classifiedBy,
            ...(inboundMessageId ? { messageId: inboundMessageId } : {}),
          },
          createdAt: now,
        },
        actorId,
      ),
    );
  } catch {
    /* timeline best-effort */
  }

  if (!isAutoReply) {
    void import("@/lib/email/email-events-server").then(({ recordEmailEvent }) =>
      recordEmailEvent({
        organizationId: input.organizationId,
        type: "replied",
        leadId: input.leadId,
        mailboxId: input.mailboxId,
        messageId: inboundMessageId,
        recipient: inboundFrom || undefined,
        meta: {
          classification: doc.classification,
          potentialScore: doc.potentialScore,
          replyActionId: actionId,
          classifiedBy: input.classifiedBy,
        },
      }),
    );
  }

  if (needsDraft) {
    // Fire-and-forget-ish: await so cron sees draft ready before tick ends, but never fail classify.
    try {
      const draft = await generateReplyActionDraftServer({
        organizationId: input.organizationId,
        actionId,
        actorUid: input.actorUid || input.mailboxOwnerUid || "system",
      });
      if (draft.ok) {
        await db
          .collection(COLLECTIONS.leads)
          .doc(input.leadId)
          .set(
            {
              nextAction: `${nextAction} · Draft ready for approval`,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
      } else {
        await db
          .collection(COLLECTIONS.leads)
          .doc(input.leadId)
          .set(
            {
              nextAction,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
      }
    } catch {
      await db
        .collection(COLLECTIONS.leads)
        .doc(input.leadId)
        .set({ nextAction, updatedAt: new Date().toISOString() }, { merge: true });
    }
  }

  return { actionId };
}

/**
 * Classify newly stored inbound lead mail and attach a pending reply action + NBA.
 * Idempotent per inboundProviderKey. Skips when AI is disabled (except OOO heuristic).
 */
export async function classifyInboundLeadMailServer(input: {
  organizationId: string;
  leadId: string;
  messages: LeadMailUpsertInput[];
  actorUid?: string;
  /** Bypass idempotent skip for pending/accepted/dismissed actions (manual re-run). */
  force?: boolean;
}): Promise<{ classified: number; skipped: number }> {
  const db = getAdminDb();
  let classified = 0;
  let skipped = 0;
  if (!db) return { classified, skipped };

  const inbound = input.messages.filter(
    (m) =>
      m.direction === "inbound" &&
      m.bodySynced !== false &&
      Boolean((m.bodyText ?? m.preview ?? "").trim()),
  );
  if (inbound.length === 0) return { classified, skipped };

  // Newest first; one classification per lead per batch is enough for NBA.
  inbound.sort((a, b) => b.date.localeCompare(a.date));
  const newest = inbound[0]!;

  const actionId = replyActionDocId(input.leadId, newest.providerKey);
  const existing = await db.collection(COLLECTIONS.replyActions).doc(actionId).get();
  if (existing.exists && !input.force) {
    const status = String(existing.data()?.status ?? "");
    if (status === "pending" || status === "accepted" || status === "dismissed") {
      skipped += 1;
      return { classified, skipped };
    }
  }

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  if (!leadSnap.exists) return { classified, skipped };
  if (String(leadSnap.data()?.organizationId ?? "") !== input.organizationId) {
    return { classified, skipped };
  }
  const lead = mapLeadDoc(leadSnap.id, leadSnap.data() as Record<string, unknown>);

  const today = new Date().toISOString().slice(0, 10);
  const rawBody = (newest.bodyText || newest.preview || "").trim();
  // Our own quoted pitch below their reply skews classification and burns tokens.
  const stripped = stripQuotedReply(rawBody);
  const body = stripped.text;
  let result = heuristicAutoReply({
    subject: newest.subject,
    preview: newest.preview || "",
    bodyText: body,
    today,
  });
  let classifiedBy: ClassifiedBy = result ? "heuristic" : "ai";
  if (!result) {
    const settings = await getOrganizationAiSettingsServer(input.organizationId);
    if (!settings.enabled || !canUseAiFeature(settings, "email_reply_classify", undefined)) {
      // AI off: still stamp human inbound so dashboard/timeline stay consistent with Inbox.
      classifiedBy = "fallback";
      result = {
        classification: "unclear",
        potentialScore: 50,
        recommendedAction: "reply_now",
        rationale: "Inbound reply detected; AI reply classify is off for this organization.",
        nextStepSummary: "Review the reply in Inbox or Emails and decide the next step.",
        waitUntilDate: "",
      };
    } else {
      try {
        const thread = await buildThreadSnippet({
          organizationId: input.organizationId,
          leadId: input.leadId,
          latestProviderKey: newest.providerKey,
        });
        const signals = buildInboundReplySignalBlock({
          from: newest.from,
          subject: newest.subject,
          body,
          receivedAt: newest.date,
          leadContactEmail: lead.contactEmail,
          inboundCount: thread.inboundCount,
          outboundCount: thread.outboundCount,
          firstOutboundAt: thread.firstOutboundAt,
          lastOutboundAt: thread.lastOutboundAt,
          hadQuotedTrail: stripped.hadQuotedTrail,
          doNotContact: lead.doNotContact,
        });

        classifiedBy = "ai";
        result = withResolvedWaitUntil(
          (
            await runAiStructuredFeature({
              organizationId: input.organizationId,
              userId: input.actorUid || "system",
              feature: "email_reply_classify",
              leadId: input.leadId,
              schema: replyClassifySchema,
              promptVars: {
                today,
                from: newest.from,
                subject: newest.subject,
                date: newest.date,
                body: body.slice(0, 8_000),
                signals,
                thread: thread.text.slice(0, 12_000),
                leadContext: leadSnapshotForClassify(lead),
              },
            })
          ).output,
          { subject: newest.subject, body, today },
        );
      } catch (error) {
        classifiedBy = "fallback";
        if (error instanceof AiForbiddenError || error instanceof AiNotConfiguredError) {
          result = {
            classification: "unclear",
            potentialScore: 50,
            recommendedAction: "reply_now",
            rationale: "Inbound reply detected; AI classify unavailable.",
            nextStepSummary: "Review the reply and decide the next step.",
            waitUntilDate: "",
          };
        } else {
          result = {
            classification: "unclear",
            potentialScore: 50,
            recommendedAction: "reply_now",
            rationale: "Inbound reply detected; classification failed.",
            nextStepSummary: "Review the reply and decide the next step.",
            waitUntilDate: "",
          };
        }
      }
    }
  }

  const source: ReplyAction["source"] =
    newest.source === "instantly"
      ? "instantly"
      : newest.source === "client_sync"
        ? "client_sync"
        : newest.source === "imap"
          ? "imap"
          : "system";

  await writeReplyActionAndLead({
    organizationId: input.organizationId,
    leadId: input.leadId,
    mailboxId: newest.mailboxId,
    mailboxOwnerUid: newest.mailboxOwnerUid || input.actorUid,
    inboundProviderKey: newest.providerKey,
    inboundPreview: body,
    inboundFrom: newest.from,
    inboundSubject: newest.subject,
    inboundMessageId: normalizeMessageId(newest.messageId) ?? undefined,
    source,
    result,
    classifiedBy,
    actorUid: input.actorUid,
    force: input.force,
  });
  classified += 1;
  return { classified, skipped };
}

export async function getReplyActionServer(input: {
  organizationId: string;
  actionId: string;
}): Promise<ReplyAction | null> {
  const db = getAdminDb();
  if (!db || !input.actionId.trim()) return null;
  const snap = await db.collection(COLLECTIONS.replyActions).doc(input.actionId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  if (String(data.organizationId ?? "") !== input.organizationId) return null;
  return {
    id: snap.id,
    organizationId: String(data.organizationId ?? ""),
    leadId: String(data.leadId ?? ""),
    mailboxId: String(data.mailboxId ?? ""),
    mailboxOwnerUid:
      typeof data.mailboxOwnerUid === "string" && data.mailboxOwnerUid.trim()
        ? data.mailboxOwnerUid.trim()
        : undefined,
    inboundProviderKey: String(data.inboundProviderKey ?? ""),
    status: (String(data.status ?? "pending") as ReplyAction["status"]),
    classification: data.classification as ReplyClass,
    potentialScore: Number(data.potentialScore ?? 0),
    recommendedAction: data.recommendedAction as ReplyRecommendedAction,
    rationale: String(data.rationale ?? ""),
    nextStepSummary: String(data.nextStepSummary ?? ""),
    waitUntilDate:
      typeof data.waitUntilDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.waitUntilDate.trim())
        ? data.waitUntilDate.trim()
        : undefined,
    draftSubject: typeof data.draftSubject === "string" ? data.draftSubject : undefined,
    draftBody: typeof data.draftBody === "string" ? data.draftBody : undefined,
    draftTo: typeof data.draftTo === "string" ? data.draftTo : undefined,
    draftInReplyTo: typeof data.draftInReplyTo === "string" ? data.draftInReplyTo : undefined,
    draftReferenceIds: Array.isArray(data.draftReferenceIds)
      ? data.draftReferenceIds.map((x) => String(x)).filter(Boolean)
      : undefined,
    inboundPreview: typeof data.inboundPreview === "string" ? data.inboundPreview : undefined,
    inboundFrom: typeof data.inboundFrom === "string" ? data.inboundFrom : undefined,
    inboundSubject: typeof data.inboundSubject === "string" ? data.inboundSubject : undefined,
    draftStatus: (data.draftStatus as ReplyAction["draftStatus"]) ?? "none",
    draftError: typeof data.draftError === "string" ? data.draftError : undefined,
    sentAt: data.sentAt != null ? coerceIsoInstant(data.sentAt) || undefined : undefined,
    sentMessageId: typeof data.sentMessageId === "string" ? data.sentMessageId : undefined,
    source: (data.source as ReplyAction["source"]) || "system",
    classifiedBy:
      data.classifiedBy === "ai" ||
      data.classifiedBy === "heuristic" ||
      data.classifiedBy === "fallback"
        ? data.classifiedBy
        : undefined,
    // deserializePayload turns *At ISO strings into Timestamp; never String(ts).
    createdAt: coerceIsoInstant(data.createdAt),
    updatedAt: coerceIsoInstant(data.updatedAt),
    decidedAt: data.decidedAt != null ? coerceIsoInstant(data.decidedAt) || undefined : undefined,
    decidedBy: typeof data.decidedBy === "string" ? data.decidedBy : undefined,
  };
}

export async function decideReplyActionServer(input: {
  organizationId: string;
  actionId: string;
  decision: "accepted" | "dismissed";
  decidedBy: string;
}): Promise<
  | {
      ok: true;
      completion?: ReplyActionCompletionOutcome;
    }
  | { ok: false; error: string; status: number }
> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured.", status: 503 };

  const action = await getReplyActionServer({
    organizationId: input.organizationId,
    actionId: input.actionId,
  });
  if (!action) return { ok: false, error: "Reply action not found.", status: 404 };
  if (action.status !== "pending") {
    return { ok: false, error: "Reply action is no longer pending.", status: 409 };
  }

  const now = new Date().toISOString();
  await db
    .collection(COLLECTIONS.replyActions)
    .doc(action.id)
    .set(
      {
        status: input.decision,
        decidedAt: now,
        decidedBy: input.decidedBy,
        updatedAt: now,
      },
      { merge: true },
    );

  const leadRef = db.collection(COLLECTIONS.leads).doc(action.leadId);
  const leadSnap = await leadRef.get();
  if (leadSnap.exists && String(leadSnap.data()?.organizationId ?? "") === input.organizationId) {
    const patch: Record<string, unknown> = {
      replyActionStatus: input.decision,
      updatedAt: now,
      lastActivityAt: now,
    };
    if (String(leadSnap.data()?.pendingReplyActionId ?? "") === action.id) {
      patch.pendingReplyActionId = FieldValue.delete();
    }
    await leadRef.update(patch);
  }

  const completion = await resolveReplyReviewAfterReplyActionServer({
    organizationId: input.organizationId,
    leadId: action.leadId,
    actorUid: input.decidedBy,
    mode: input.decision === "accepted" ? "completed" : "suggestion_dismissed",
    classification: action.classification,
    recommendedAction: action.recommendedAction,
  });

  return { ok: true, completion };
}
