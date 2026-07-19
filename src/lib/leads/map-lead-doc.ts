import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import type {
  ChannelKey,
  Lead,
  ProspectChannelAssignment,
  ProspectVisibility,
} from "@/lib/types";

function parseProspectChannelAssignments(
  raw: unknown,
): ProspectChannelAssignment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ProspectChannelAssignment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const channel = typeof row.channel === "string" ? (row.channel as ChannelKey) : null;
    const assigneeId = typeof row.assigneeId === "string" ? row.assigneeId : "";
    const assignedById = typeof row.assignedById === "string" ? row.assignedById : "";
    if (!id || !channel || !assigneeId) continue;
    out.push({
      id,
      channel,
      assigneeId,
      assignedById,
      assignedAt: firestoreValueToIso(row.assignedAt),
      pushedAt: row.pushedAt ? firestoreValueToIso(row.pushedAt) : undefined,
      pushedByUserId:
        typeof row.pushedByUserId === "string" ? row.pushedByUserId : undefined,
    });
  }
  return out.length ? out : undefined;
}

function parseChannelKeyArray(raw: unknown): ChannelKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((v): v is ChannelKey => typeof v === "string" && v.length > 0);
  return out.length ? out : undefined;
}

function parseStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  return out.length ? out : undefined;
}

/** Normalize a Firestore lead document into a typed `Lead`. */
export function mapLeadDoc(id: string, raw: Record<string, unknown>): Lead {
  const base = { ...raw, id } as unknown as Lead;
  const prospectVisibility =
    raw.prospectVisibility === "open" || raw.prospectVisibility === "assigned"
      ? (raw.prospectVisibility as ProspectVisibility)
      : undefined;

  return {
    ...base,
    id,
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
    firstContactAt: raw.firstContactAt ? firestoreValueToIso(raw.firstContactAt) : undefined,
    lastActivityAt: raw.lastActivityAt ? firestoreValueToIso(raw.lastActivityAt) : undefined,
    expectedCloseDate: raw.expectedCloseDate
      ? firestoreValueToIso(raw.expectedCloseDate)
      : undefined,
    prospectOwnerId:
      typeof raw.prospectOwnerId === "string" ? raw.prospectOwnerId : undefined,
    prospectVisibility,
    prospectChannelAssignments: parseProspectChannelAssignments(
      raw.prospectChannelAssignments,
    ),
    prospectAssigneeIds: parseStringArray(raw.prospectAssigneeIds),
    linkedSalesLeadId:
      typeof raw.linkedSalesLeadId === "string" ? raw.linkedSalesLeadId : undefined,
    prospectSourceId:
      typeof raw.prospectSourceId === "string" ? raw.prospectSourceId : undefined,
    channelTags: parseChannelKeyArray(raw.channelTags),
    sharedOwnerIds: parseStringArray(raw.sharedOwnerIds),
    lastReplyAt: raw.lastReplyAt ? firestoreValueToIso(raw.lastReplyAt) : undefined,
    lastReplyMessageId:
      typeof raw.lastReplyMessageId === "string" ? raw.lastReplyMessageId : undefined,
    lastReplySource:
      raw.lastReplySource === "imap" ||
      raw.lastReplySource === "instantly" ||
      raw.lastReplySource === "manual"
        ? raw.lastReplySource
        : undefined,
    replyReviewStatus:
      raw.replyReviewStatus === "pending" ||
      raw.replyReviewStatus === "dismissed" ||
      raw.replyReviewStatus === "accepted"
        ? raw.replyReviewStatus
        : undefined,
    strategyId: typeof raw.strategyId === "string" ? raw.strategyId : undefined,
    personaId: typeof raw.personaId === "string" ? raw.personaId : undefined,
    strategyVersion:
      typeof raw.strategyVersion === "number" ? raw.strategyVersion : undefined,
    strategyAssignmentId:
      typeof raw.strategyAssignmentId === "string" ? raw.strategyAssignmentId : undefined,
  };
}
