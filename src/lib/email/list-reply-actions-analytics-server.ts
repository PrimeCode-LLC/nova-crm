import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  outcomeFromLeadStage,
  type ReplyActionAnalyticsRow,
} from "@/lib/email/reply-action-analytics";
import type {
  ReplyAction,
  ReplyActionStatus,
  ReplyClass,
  ReplyRecommendedAction,
} from "@/lib/email/reply-action-types";

const MAX_ROWS = 2_000;

function parseReplyAction(id: string, data: Record<string, unknown>): ReplyAction | null {
  const organizationId = String(data.organizationId ?? "").trim();
  const leadId = String(data.leadId ?? "").trim();
  const classification = data.classification as ReplyClass | undefined;
  if (!organizationId || !leadId || !classification) return null;

  return {
    id,
    organizationId,
    leadId,
    mailboxId: String(data.mailboxId ?? ""),
    mailboxOwnerUid:
      typeof data.mailboxOwnerUid === "string" && data.mailboxOwnerUid.trim()
        ? data.mailboxOwnerUid.trim()
        : undefined,
    inboundProviderKey: String(data.inboundProviderKey ?? ""),
    status: (String(data.status ?? "pending") as ReplyActionStatus),
    classification,
    potentialScore: Number(data.potentialScore ?? 0),
    recommendedAction: data.recommendedAction as ReplyRecommendedAction,
    rationale: String(data.rationale ?? ""),
    nextStepSummary: String(data.nextStepSummary ?? ""),
    draftSubject: typeof data.draftSubject === "string" ? data.draftSubject : undefined,
    draftBody: typeof data.draftBody === "string" ? data.draftBody : undefined,
    draftTo: typeof data.draftTo === "string" ? data.draftTo : undefined,
    draftInReplyTo: typeof data.draftInReplyTo === "string" ? data.draftInReplyTo : undefined,
    draftReferenceIds: Array.isArray(data.draftReferenceIds)
      ? data.draftReferenceIds.map((x) => String(x)).filter(Boolean)
      : undefined,
    draftStatus: (data.draftStatus as ReplyAction["draftStatus"]) ?? "none",
    draftError: typeof data.draftError === "string" ? data.draftError : undefined,
    sentAt: typeof data.sentAt === "string" ? data.sentAt : undefined,
    sentMessageId: typeof data.sentMessageId === "string" ? data.sentMessageId : undefined,
    source: (data.source as ReplyAction["source"]) || "system",
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
    decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : undefined,
    decidedBy: typeof data.decidedBy === "string" ? data.decidedBy : undefined,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * List org reply actions in a createdAt window and join lead stage for outcomes.
 */
export async function listReplyActionsForAnalyticsServer(input: {
  organizationId: string;
  fromIso: string;
  toIso: string;
  classification?: string;
  status?: string;
}): Promise<ReplyActionAnalyticsRow[]> {
  const db = getAdminDb();
  if (!db) return [];

  const snap = await db
    .collection(COLLECTIONS.replyActions)
    .where("organizationId", "==", input.organizationId)
    .limit(MAX_ROWS)
    .get();

  const fromMs = new Date(input.fromIso).getTime();
  const toMs = new Date(input.toIso).getTime();

  const actions: ReplyAction[] = [];
  for (const doc of snap.docs) {
    const row = parseReplyAction(doc.id, doc.data() as Record<string, unknown>);
    if (!row) continue;
    const t = new Date(row.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < fromMs || t > toMs) continue;
    if (input.classification && input.classification !== "all" && row.classification !== input.classification) {
      continue;
    }
    if (input.status && input.status !== "all" && row.status !== input.status) {
      continue;
    }
    actions.push(row);
  }

  const leadIds = [...new Set(actions.map((a) => a.leadId))];
  const leadMeta = new Map<string, { stage?: string; ownerId?: string }>();

  for (const group of chunkArray(leadIds, 100)) {
    const refs = group.map((id) => db.collection(COLLECTIONS.leads).doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((leadSnap, index) => {
      if (!leadSnap.exists) return;
      const data = leadSnap.data() as Record<string, unknown>;
      if (String(data.organizationId ?? "") !== input.organizationId) return;
      leadMeta.set(group[index]!, {
        stage: typeof data.stage === "string" ? data.stage : undefined,
        ownerId: typeof data.ownerId === "string" ? data.ownerId : undefined,
      });
    });
  }

  return actions.map((action): ReplyActionAnalyticsRow => {
    const meta = leadMeta.get(action.leadId);
    return {
      ...action,
      leadStage: meta?.stage,
      leadOwnerId: meta?.ownerId,
      outcome: outcomeFromLeadStage(meta?.stage),
    };
  });
}
