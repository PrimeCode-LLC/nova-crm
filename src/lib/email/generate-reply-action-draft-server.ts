import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { AiForbiddenError, AiNotConfiguredError, runAiTextFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveOutreachKnowledgeServer } from "@/lib/ai/outreach-knowledge-server";
import { listLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import { extractReplyAddress, replySubject } from "@/lib/email/reply-compose";
import { stripTrailingEmailSignOff } from "@/lib/email/strip-trailing-email-signoff";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import {
  draftGoalForReplyAction,
  replyActionNeedsDraft,
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
      companyName: lead.companyName,
      contactName: lead.contactName,
      contactTitle: lead.contactTitle,
      contactEmail: lead.contactEmail,
      channel: lead.channel,
      notes: lead.notes?.slice(0, 400),
    },
    null,
    2,
  );
}

async function buildThreadForDraft(input: {
  organizationId: string;
  leadId: string;
}): Promise<{ thread: string; subject: string; to: string; inReplyTo?: string; referenceIds?: string[] }> {
  const rows = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: input.leadId,
    limit: 24,
  });
  const chronological = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const latestInbound = [...chronological].reverse().find((r) => r.direction === "inbound");
  const lines: string[] = [];
  for (const row of chronological.slice(-12)) {
    const who = row.direction === "inbound" ? "THEM" : "US";
    const snippet = (row.bodyText || row.preview || "").replace(/\s+/g, " ").trim().slice(0, 600);
    lines.push(`[${who}] ${row.date} · ${row.subject}\nFrom: ${row.from}\n${snippet}`);
  }

  const to =
    (latestInbound ? extractReplyAddress(latestInbound.replyTo || latestInbound.from) : "") ||
    "";
  const subject = replySubject(latestInbound?.subject);
  const inReplyTo = normalizeMessageId(latestInbound?.messageId);
  const referenceIds = [
    ...(latestInbound?.referenceIds ?? []),
    ...(inReplyTo ? [inReplyTo] : []),
  ]
    .map((id) => normalizeMessageId(id))
    .filter((id): id is string => Boolean(id))
    .slice(-50);

  return {
    thread: lines.length ? lines.join("\n\n") : "(no prior thread stored)",
    subject,
    to,
    inReplyTo,
    referenceIds: referenceIds.length ? referenceIds : undefined,
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

  try {
    const threadCtx = await buildThreadForDraft({
      organizationId: input.organizationId,
      leadId,
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
        tone: "professional",
        goal,
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
      draftStatus: "ready" as const,
      draftError: null,
      updatedAt: new Date().toISOString(),
    });

    await db.collection(COLLECTIONS.replyActions).doc(input.actionId).set(patch, { merge: true });
    return {
      ok: true,
      action: {
        draftBody,
        draftSubject: threadCtx.subject,
        draftTo: to,
        draftInReplyTo: threadCtx.inReplyTo,
        draftReferenceIds: threadCtx.referenceIds,
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
