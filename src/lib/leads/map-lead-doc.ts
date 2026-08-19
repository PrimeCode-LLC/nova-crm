import { documentTimestampToIso } from "@/lib/documents/timestamp-util";
import type {
  ChannelKey,
  Lead,
  ProspectChannelAssignment,
  ProspectVisibility,
} from "@/lib/types";
import type {
  IntentEvidence,
  PersonalizationNote,
  ProspectQualifyStatus,
  ProspectRejectionReason,
} from "@/lib/prospecting-strategy/qualify";

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
      assignedAt: documentTimestampToIso(row.assignedAt),
      pushedAt: row.pushedAt ? documentTimestampToIso(row.pushedAt) : undefined,
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

function parseIntentEvidence(raw: unknown): IntentEvidence[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: IntentEvidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const strength = row.strength === "strong" || row.strength === "medium" ? row.strength : null;
    if (!id || !strength) continue;
    out.push({
      id,
      label: String(row.label ?? ""),
      category: String(row.category ?? ""),
      strength,
      sourceUrl: String(row.sourceUrl ?? ""),
      observedAt: String(row.observedAt ?? ""),
      explanation: String(row.explanation ?? ""),
      signalId: typeof row.signalId === "string" ? row.signalId : undefined,
    });
  }
  return out.length ? out : undefined;
}

function parsePersonalization(raw: unknown): PersonalizationNote | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  return {
    trigger: String(row.trigger ?? ""),
    likelyImpact: String(row.likelyImpact ?? ""),
    relevantService: String(row.relevantService ?? ""),
    suggestedAngle: String(row.suggestedAngle ?? ""),
  };
}

/** Normalize a Firestore lead document into a typed `Lead`. */
export function mapLeadDoc(id: string, raw: Record<string, unknown>): Lead {
  const base = { ...raw, id } as unknown as Lead;
  const prospectVisibility =
    raw.prospectVisibility === "open" || raw.prospectVisibility === "assigned"
      ? (raw.prospectVisibility as ProspectVisibility)
      : undefined;

  const qualifyStatus =
    raw.prospectQualifyStatus === "incomplete" ||
    raw.prospectQualifyStatus === "completed" ||
    raw.prospectQualifyStatus === "rejected"
      ? (raw.prospectQualifyStatus as ProspectQualifyStatus)
      : undefined;

  return {
    ...base,
    id,
    createdAt: documentTimestampToIso(raw.createdAt),
    updatedAt: documentTimestampToIso(raw.updatedAt),
    firstContactAt: raw.firstContactAt ? documentTimestampToIso(raw.firstContactAt) : undefined,
    lastActivityAt: raw.lastActivityAt ? documentTimestampToIso(raw.lastActivityAt) : undefined,
    expectedCloseDate: raw.expectedCloseDate
      ? documentTimestampToIso(raw.expectedCloseDate)
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
    lastReplyAt: raw.lastReplyAt ? documentTimestampToIso(raw.lastReplyAt) : undefined,
    lastReplyMessageId:
      typeof raw.lastReplyMessageId === "string" ? raw.lastReplyMessageId : undefined,
    lastReplySource:
      raw.lastReplySource === "imap" ||
      raw.lastReplySource === "instantly" ||
      raw.lastReplySource === "manual"
        ? raw.lastReplySource
        : undefined,
    lastAutoReplyAt: raw.lastAutoReplyAt
      ? documentTimestampToIso(raw.lastAutoReplyAt)
      : undefined,
    lastAutoReplyMessageId:
      typeof raw.lastAutoReplyMessageId === "string"
        ? raw.lastAutoReplyMessageId
        : undefined,
    followUpAfterDate:
      typeof raw.followUpAfterDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw.followUpAfterDate.trim())
        ? raw.followUpAfterDate.trim()
        : undefined,
    lastEmailOpenedAt: raw.lastEmailOpenedAt
      ? documentTimestampToIso(raw.lastEmailOpenedAt)
      : undefined,
    emailOpenCount:
      typeof raw.emailOpenCount === "number" && Number.isFinite(raw.emailOpenCount)
        ? raw.emailOpenCount
        : undefined,
    replyReviewStatus:
      raw.replyReviewStatus === "pending" ||
      raw.replyReviewStatus === "dismissed" ||
      raw.replyReviewStatus === "accepted"
        ? raw.replyReviewStatus
        : undefined,
    emailMailCount:
      typeof raw.emailMailCount === "number" && Number.isFinite(raw.emailMailCount)
        ? raw.emailMailCount
        : undefined,
    lastEmailAt: raw.lastEmailAt ? documentTimestampToIso(raw.lastEmailAt) : undefined,
    lastInboundEmailAt: raw.lastInboundEmailAt
      ? documentTimestampToIso(raw.lastInboundEmailAt)
      : undefined,
    pendingReplyActionId:
      typeof raw.pendingReplyActionId === "string" && raw.pendingReplyActionId.trim()
        ? raw.pendingReplyActionId.trim()
        : undefined,
    replyClass:
      raw.replyClass === "auto_reply" ||
      raw.replyClass === "positive" ||
      raw.replyClass === "meeting_ready" ||
      raw.replyClass === "neutral" ||
      raw.replyClass === "objection" ||
      raw.replyClass === "soft_no" ||
      raw.replyClass === "hard_no" ||
      raw.replyClass === "unclear"
        ? raw.replyClass
        : undefined,
    replyActionStatus:
      raw.replyActionStatus === "pending" ||
      raw.replyActionStatus === "accepted" ||
      raw.replyActionStatus === "dismissed" ||
      raw.replyActionStatus === "expired" ||
      raw.replyActionStatus === "sent"
        ? raw.replyActionStatus
        : undefined,
    strategyId: typeof raw.strategyId === "string" ? raw.strategyId : undefined,
    personaId: typeof raw.personaId === "string" ? raw.personaId : undefined,
    strategyVersion:
      typeof raw.strategyVersion === "number" ? raw.strategyVersion : undefined,
    strategyAssignmentId:
      typeof raw.strategyAssignmentId === "string" ? raw.strategyAssignmentId : undefined,
    intentEvidence: parseIntentEvidence(raw.intentEvidence),
    personalizationNote: parsePersonalization(raw.personalizationNote),
    prospectQualifyStatus: qualifyStatus,
    rejectionReason:
      typeof raw.rejectionReason === "string"
        ? (raw.rejectionReason as ProspectRejectionReason)
        : undefined,
    rejectionNote: typeof raw.rejectionNote === "string" ? raw.rejectionNote : undefined,
    deeplyPersonalized: raw.deeplyPersonalized === true ? true : undefined,
    emailVerified: raw.emailVerified === true ? true : undefined,
    emailVerificationStatus:
      raw.emailVerificationStatus === "verified" ||
      raw.emailVerificationStatus === "not_verified" ||
      raw.emailVerificationStatus === "bounced" ||
      raw.emailVerificationStatus === "catch_all"
        ? raw.emailVerificationStatus
        : undefined,
    emailVerificationSource:
      raw.emailVerificationSource === "millionverifier" ||
      raw.emailVerificationSource === "bounce" ||
      raw.emailVerificationSource === "manual"
        ? raw.emailVerificationSource
        : undefined,
    archivedAt: raw.archivedAt ? documentTimestampToIso(raw.archivedAt) : undefined,
    archivedBy: typeof raw.archivedBy === "string" ? raw.archivedBy : undefined,
    archiveReason:
      raw.archiveReason === "manual" ||
      raw.archiveReason === "lost" ||
      raw.archiveReason === "rejected"
        ? raw.archiveReason
        : undefined,
  };
}
