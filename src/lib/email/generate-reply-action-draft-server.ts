import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { AiForbiddenError, AiNotConfiguredError, runAiTextFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveOutreachKnowledgeServer } from "@/lib/ai/outreach-knowledge-server";
import {
  buildFollowupPersonalizationProfile,
  formatFollowupRoleGuidance,
} from "@/lib/ai/followup-personalization";
import { buildLeadSignalProfile, formatLeadSignalGuidance } from "@/lib/ai/lead-signal-profile";
import {
  getLeadMailMessageServer,
  listLeadMailMessagesServer,
} from "@/lib/email/lead-mail-store-server";
import { extractReplyAddress, replySubject } from "@/lib/email/reply-compose";
import { replyTextOnly } from "@/lib/email/strip-quoted-reply";
import { stripTrailingEmailSignOff } from "@/lib/email/strip-trailing-email-signoff";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import {
  draftGoalForReplyAction,
  replyActionNeedsDraft,
  REPLY_CLASS_LABELS,
  type ReplyAction,
  type ReplyClass,
  type ReplyRecommendedAction,
} from "@/lib/email/reply-action-types";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";

function leadSnapshot(lead: ReturnType<typeof mapLeadDoc>): string {
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
      notes: lead.notes?.slice(0, 400),
    },
    null,
    2,
  );
}

/**
 * Carry the classifier's decision and the sequence-grade role targets into the
 * draft so an approved next step and the written email cannot drift apart.
 */
function buildReplyGuidance(input: {
  lead: ReturnType<typeof mapLeadDoc>;
  classification: ReplyClass;
  recommendedAction: ReplyRecommendedAction;
  potentialScore: number;
  nextStepSummary: string;
  regenerateDirection?: string;
}): string {
  const profile = buildFollowupPersonalizationProfile({ title: input.lead.contactTitle });
  const signalProfile = buildLeadSignalProfile({ lead: input.lead });

  const lines = [
    `Reply classification: ${REPLY_CLASS_LABELS[input.classification]} (${input.classification})`,
    `Recommended action: ${input.recommendedAction}`,
    `Potential score: ${Math.round(input.potentialScore)}/100`,
    `Approved next step (write the email that delivers this): ${input.nextStepSummary || "Advance toward a clear next step"}`,
    "",
    formatFollowupRoleGuidance(profile),
    formatLeadSignalGuidance(signalProfile),
    `Lead stage: ${input.lead.stage || "unknown"}`,
    `Temperature: ${input.lead.temperature || "unknown"}`,
  ];

  if (input.regenerateDirection?.trim()) {
    lines.push("", `Regenerate direction (mandatory): ${input.regenerateDirection.trim()}`);
  }

  if (input.lead.doNotContact) {
    lines.push(
      "COMPLIANCE: this lead is marked do-not-contact. Acknowledge and close out. Do not pitch and do not ask for a meeting.",
    );
  }

  return lines.filter((line) => line !== undefined).join("\n");
}

async function buildThreadForDraft(input: {
  organizationId: string;
  leadId: string;
  inboundProviderKey?: string;
  draftInReplyTo?: string;
}): Promise<{
  thread: string;
  subject: string;
  to: string;
  inReplyTo?: string;
  referenceIds?: string[];
  inboundPreview?: string;
  inboundFrom?: string;
  inboundSubject?: string;
  mailboxId?: string;
}> {
  const rows = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: input.leadId,
    limit: 24,
  });
  const chronological = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  let targetInbound =
    (input.inboundProviderKey
      ? await getLeadMailMessageServer({
          organizationId: input.organizationId,
          leadId: input.leadId,
          providerKey: input.inboundProviderKey,
        })
      : null) ||
    chronological
      .slice()
      .reverse()
      .find(
        (r) =>
          r.direction === "inbound" &&
          (!input.draftInReplyTo ||
            normalizeMessageId(r.messageId) === normalizeMessageId(input.draftInReplyTo)),
      ) ||
    chronological.slice().reverse().find((r) => r.direction === "inbound");

  const lines: string[] = [];
  for (const row of chronological.slice(-12)) {
    const who = row.direction === "inbound" ? "THEM" : "US";
    const snippet = replyTextOnly(row.bodyText || row.preview || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
    lines.push(`[${who}] ${row.date} · ${row.subject}\nFrom: ${row.from}\n${snippet}`);
  }

  const to =
    (targetInbound ? extractReplyAddress(targetInbound.replyTo || targetInbound.from) : "") || "";
  const subject = replySubject(targetInbound?.subject);
  const inReplyTo = normalizeMessageId(targetInbound?.messageId) || normalizeMessageId(input.draftInReplyTo);
  const referenceIds = [
    ...(targetInbound?.referenceIds ?? []),
    ...(inReplyTo ? [inReplyTo] : []),
  ]
    .map((id) => normalizeMessageId(id))
    .filter((id): id is string => Boolean(id))
    .slice(-50);

  const inboundPreview = targetInbound
    ? replyTextOnly(targetInbound.bodyText || targetInbound.preview || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280)
    : undefined;

  return {
    thread: lines.length ? lines.join("\n\n") : "(no prior thread stored)",
    subject,
    to,
    inReplyTo,
    referenceIds: referenceIds.length ? referenceIds : undefined,
    inboundPreview: inboundPreview || undefined,
    inboundFrom: targetInbound?.from,
    inboundSubject: targetInbound?.subject,
    mailboxId: targetInbound?.mailboxId,
  };
}

/**
 * Generate (or regenerate) an approve-ready reply draft on a reply action.
 */
export async function generateReplyActionDraftServer(input: {
  organizationId: string;
  actionId: string;
  actorUid?: string;
  force?: boolean;
  regenerateDirection?: string;
}): Promise<{ ok: true; action: Partial<ReplyAction> } | { ok: false; error: string; status: number }> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured.", status: 503 };

  const snap = await db.collection(COLLECTIONS.replyActions).doc(input.actionId).get();
  if (!snap.exists) return { ok: false, error: "Reply action not found.", status: 404 };
  const data = snap.data() as Record<string, unknown>;
  if (String(data.organizationId ?? "") !== input.organizationId) {
    return { ok: false, error: "Reply action not found.", status: 404 };
  }

  const classification = String(data.classification ?? "unclear") as ReplyClass;
  const recommendedAction = String(data.recommendedAction ?? "reply_now") as ReplyRecommendedAction;
  const nextStepSummary = String(data.nextStepSummary ?? "");
  if (
    !input.force &&
    !replyActionNeedsDraft({ classification, recommendedAction })
  ) {
    return { ok: false, error: "This reply type does not need a draft.", status: 409 };
  }

  const leadId = String(data.leadId ?? "");
  const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
  if (!leadSnap.exists || String(leadSnap.data()?.organizationId ?? "") !== input.organizationId) {
    return { ok: false, error: "Lead not found.", status: 404 };
  }
  const lead = mapLeadDoc(leadSnap.id, leadSnap.data() as Record<string, unknown>);

  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  if (!settings.enabled || !canUseAiFeature(settings, "email_reply", undefined)) {
    return { ok: false, error: "AI email reply is not enabled.", status: 403 };
  }

  const now = new Date().toISOString();
  await db.collection(COLLECTIONS.replyActions).doc(input.actionId).set(
    { draftStatus: "pending", draftError: null, updatedAt: now },
    { merge: true },
  );

  // Surface generating state on the lead NBA while regenerate runs.
  if (input.force) {
    const baseNext = formatReplyNextActionForLead(data);
    await db
      .collection(COLLECTIONS.leads)
      .doc(leadId)
      .set(
        {
          nextAction: `${baseNext} · Rewriting draft…`,
          updatedAt: now,
        },
        { merge: true },
      )
      .catch(() => undefined);
  }

  try {
    const threadCtx = await buildThreadForDraft({
      organizationId: input.organizationId,
      leadId,
      inboundProviderKey: String(data.inboundProviderKey ?? "") || undefined,
      draftInReplyTo:
        typeof data.draftInReplyTo === "string" ? data.draftInReplyTo : undefined,
    });
    const to = threadCtx.to || lead.contactEmail?.trim() || "";
    if (!to) {
      await db.collection(COLLECTIONS.replyActions).doc(input.actionId).set(
        {
          draftStatus: "failed",
          draftError: "No recipient email on the inbound reply or lead.",
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      return { ok: false, error: "No recipient email found.", status: 409 };
    }

    const feat = settings.features.email_reply;
    const { ragBlock } = await retrieveOutreachKnowledgeServer({
      organizationId: input.organizationId,
      query: threadCtx.thread.slice(0, 500),
      configuredLibraryIds: feat.libraryIds,
      ragMode: feat.ragMode ?? "reference",
      scope: {
        channel: lead.channel,
        profileId: lead.profileId,
        campaignId: lead.campaignId,
      },
    });

    const goal = draftGoalForReplyAction({
      classification,
      recommendedAction,
      nextStepSummary,
    });

    const body = await runAiTextFeature({
      organizationId: input.organizationId,
      userId: input.actorUid || "system",
      feature: "email_reply",
      leadId,
      promptVars: {
        today: new Date().toISOString().slice(0, 10),
        tone: "professional",
        goal,
        replyGuidance: buildReplyGuidance({
          lead,
          classification,
          recommendedAction,
          potentialScore: Number(data.potentialScore ?? 0),
          nextStepSummary,
          regenerateDirection: input.regenerateDirection,
        }),
        thread: threadCtx.thread.slice(0, 20_000),
        leadContext: leadSnapshot(lead),
        ragBlock: ragBlock || "(none)",
      },
    });

    const draftBody = stripTrailingEmailSignOff(body).trim();
    const patch = stripUndefined({
      draftBody,
      draftSubject: threadCtx.subject,
      draftTo: to,
      draftInReplyTo: threadCtx.inReplyTo,
      draftReferenceIds: threadCtx.referenceIds,
      inboundPreview: threadCtx.inboundPreview || data.inboundPreview,
      inboundFrom: threadCtx.inboundFrom || data.inboundFrom,
      inboundSubject: threadCtx.inboundSubject || data.inboundSubject,
      draftStatus: "ready" as const,
      draftError: null,
      updatedAt: new Date().toISOString(),
    });

    await db.collection(COLLECTIONS.replyActions).doc(input.actionId).set(patch, { merge: true });

    if (input.force) {
      const baseNext = formatReplyNextActionForLead(data);
      await db
        .collection(COLLECTIONS.leads)
        .doc(leadId)
        .set(
          {
            nextAction: `${baseNext} · Draft ready for approval`,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        )
        .catch(() => undefined);
    }

    return {
      ok: true,
      action: {
        draftBody,
        draftSubject: threadCtx.subject,
        draftTo: to,
        draftInReplyTo: threadCtx.inReplyTo,
        draftReferenceIds: threadCtx.referenceIds,
        inboundPreview: typeof patch.inboundPreview === "string" ? patch.inboundPreview : undefined,
        inboundFrom: typeof patch.inboundFrom === "string" ? patch.inboundFrom : undefined,
        inboundSubject: typeof patch.inboundSubject === "string" ? patch.inboundSubject : undefined,
        draftStatus: "ready",
      },
    };
  } catch (error) {
    const message =
      error instanceof AiForbiddenError || error instanceof AiNotConfiguredError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Draft generation failed";
    await db.collection(COLLECTIONS.replyActions).doc(input.actionId).set(
      {
        draftStatus: "failed",
        draftError: message.slice(0, 500),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    return { ok: false, error: message, status: 500 };
  }
}

function formatReplyNextActionForLead(data: Record<string, unknown>): string {
  const classification = String(data.classification ?? "unclear") as ReplyClass;
  const nextStepSummary = String(data.nextStepSummary ?? "");
  const potentialScore = Number(data.potentialScore ?? 0);
  const label = REPLY_CLASS_LABELS[classification] || "Reply analyzed";
  const score =
    Number.isFinite(potentialScore) && classification !== "auto_reply"
      ? ` · potential ${Math.round(potentialScore)}`
      : "";
  const step = nextStepSummary.trim();
  return step ? `${label}${score}: ${step}` : `${label}${score}`;
}
