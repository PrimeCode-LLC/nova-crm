import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
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
import type { ProspectChannelAssignment } from "@/lib/types";

const MAX_ROWS = 2_000;

type LeadAnalyticsMeta = {
  stage?: string;
  ownerId?: string;
  contactName?: string;
  companyName?: string;
  sharedOwnerIds?: string[];
  intakeKind?: "prospect" | "sales_lead";
  scraperId?: string;
  prospectOwnerId?: string;
  createdById?: string;
  prospectAssigneeIds?: string[];
};

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
    inboundPreview: typeof data.inboundPreview === "string" ? data.inboundPreview : undefined,
    inboundFrom: typeof data.inboundFrom === "string" ? data.inboundFrom : undefined,
    inboundSubject: typeof data.inboundSubject === "string" ? data.inboundSubject : undefined,
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

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((x) => String(x).trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function parseProspectAssigneeIds(data: Record<string, unknown>): string[] | undefined {
  const denorm = parseStringArray(data.prospectAssigneeIds);
  if (denorm?.length) return denorm;
  const assignments = data.prospectChannelAssignments;
  if (!Array.isArray(assignments)) return undefined;
  const ids = [
    ...new Set(
      assignments
        .map((a) =>
          a && typeof a === "object"
            ? String((a as ProspectChannelAssignment).assigneeId ?? "").trim()
            : "",
        )
        .filter(Boolean),
    ),
  ];
  return ids.length ? ids : undefined;
}

function parseLeadMeta(data: Record<string, unknown>): LeadAnalyticsMeta {
  const intakeRaw = typeof data.intakeKind === "string" ? data.intakeKind : undefined;
  const intakeKind =
    intakeRaw === "prospect" || intakeRaw === "sales_lead" ? intakeRaw : undefined;

  return {
    stage: typeof data.stage === "string" ? data.stage : undefined,
    ownerId: typeof data.ownerId === "string" ? data.ownerId : undefined,
    contactName: typeof data.contactName === "string" ? data.contactName : undefined,
    companyName: typeof data.companyName === "string" ? data.companyName : undefined,
    sharedOwnerIds: parseStringArray(data.sharedOwnerIds),
    intakeKind,
    scraperId: typeof data.scraperId === "string" ? data.scraperId : undefined,
    prospectOwnerId:
      typeof data.prospectOwnerId === "string" ? data.prospectOwnerId : undefined,
    createdById: typeof data.createdById === "string" ? data.createdById : undefined,
    prospectAssigneeIds: parseProspectAssigneeIds(data),
  };
}

/**
 * List org reply actions in a createdAt window and join lead stage / ownership for outcomes
 * and hierarchy visibility.
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
  const leadMeta = new Map<string, LeadAnalyticsMeta>();

  for (const group of chunkArray(leadIds, 100)) {
    const refs = group.map((id) => db.collection(COLLECTIONS.leads).doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((leadSnap, index) => {
      if (!leadSnap.exists) return;
      const data = leadSnap.data() as Record<string, unknown>;
      if (String(data.organizationId ?? "") !== input.organizationId) return;
      leadMeta.set(group[index]!, parseLeadMeta(data));
    });
  }

  return actions.map((action): ReplyActionAnalyticsRow => {
    const meta = leadMeta.get(action.leadId);
    return {
      ...action,
      leadStage: meta?.stage,
      leadOwnerId: meta?.ownerId,
      leadContactName: meta?.contactName,
      leadCompanyName: meta?.companyName,
      leadSharedOwnerIds: meta?.sharedOwnerIds,
      leadIntakeKind: meta?.intakeKind,
      leadScraperId: meta?.scraperId,
      leadProspectOwnerId: meta?.prospectOwnerId,
      leadCreatedById: meta?.createdById,
      leadProspectAssigneeIds: meta?.prospectAssigneeIds,
      outcome: outcomeFromLeadStage(meta?.stage),
    };
  });
}
