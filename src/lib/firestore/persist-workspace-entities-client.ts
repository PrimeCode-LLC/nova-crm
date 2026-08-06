import {
  deleteDoc,
  deleteField,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsClient } from "@/lib/firestore/resolve-owner-manager-ids-client";
import type {
  ActivityCounterRow,
  Campaign,
  Followup,
  LeadTask,
  Note,
  Profile,
  Touchpoint,
  TimelineEvent,
  WorkspaceChatChannel,
  WorkspaceChatMessage,
} from "@/lib/types";

export async function persistNoteCreate(
  db: Firestore,
  organizationId: string,
  note: Note,
  opts?: { leadOwnerId?: string; leadOwnerManagerIds?: string[] },
): Promise<void> {
  /** Omit optional string fields instead of writing `null` - Firestore `null` was deserialized so `asNote` dropped `leadId` and notes disappeared from the lead tab. */
  const data: Record<string, unknown> = {
    organizationId,
    authorId: note.authorId,
    body: note.body,
    pinned: note.pinned ?? false,
    createdAt: note.createdAt,
  };
  if (note.leadId) data.leadId = note.leadId;
  if (note.contactId) data.contactId = note.contactId;
  if (note.accountId) data.accountId = note.accountId;
  if (note.dealId) data.dealId = note.dealId;
  if (note.leadId) {
    const leadOwnerId = opts?.leadOwnerId ?? "";
    data.leadOwnerId = leadOwnerId;
    data.leadOwnerManagerIds =
      opts?.leadOwnerManagerIds ?? (await resolveOwnerManagerIdsClient(db, leadOwnerId));
  }
  await setDoc(doc(db, COLLECTIONS.notes, note.id), data);
}

export async function persistNoteUpdate(
  db: Firestore,
  noteId: string,
  patch: Partial<Pick<Note, "body" | "pinned">>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.body !== undefined) payload.body = patch.body;
  if (patch.pinned !== undefined) payload.pinned = patch.pinned;
  await updateDoc(doc(db, COLLECTIONS.notes, noteId), payload);
}

export async function persistNoteDelete(db: Firestore, noteId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.notes, noteId));
}

export async function persistFollowupCreate(
  db: Firestore,
  organizationId: string,
  f: Followup,
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    title: f.title,
    dueAt: f.dueAt,
    ownerId: f.ownerId,
    ownerManagerIds: opts?.ownerManagerIds ?? (await resolveOwnerManagerIdsClient(db, f.ownerId)),
    priority: f.priority,
    auto: f.auto,
  };
  if (f.leadId) data.leadId = f.leadId;
  if (f.dealId) data.dealId = f.dealId;
  if (f.contactId) data.contactId = f.contactId;
  if (f.description) data.description = f.description;
  if (f.messageBody) data.messageBody = f.messageBody;
  if (f.emailSubject) data.emailSubject = f.emailSubject;
  if (f.channel) data.channel = f.channel;
  if (f.planId) data.planId = f.planId;
  if (f.aiGenerated) data.aiGenerated = f.aiGenerated;
  if (f.pausedAt) data.pausedAt = f.pausedAt;
  if (f.completedAt) data.completedAt = f.completedAt;
  if (f.deliveryStatus) data.deliveryStatus = f.deliveryStatus;
  if (f.sentAt) data.sentAt = f.sentAt;
  if (f.sentMessageId) data.sentMessageId = f.sentMessageId;
  if (f.failedAt) data.failedAt = f.failedAt;
  if (f.cancelledAt) data.cancelledAt = f.cancelledAt;
  if (f.deliveryError) data.deliveryError = f.deliveryError;
  if (f.cancelReason) data.cancelReason = f.cancelReason;
  await setDoc(doc(db, COLLECTIONS.followups, f.id), data);
}

export async function persistFollowupSetPaused(
  db: Firestore,
  followupId: string,
  paused: boolean,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.followups, followupId), {
    pausedAt: paused ? serverTimestamp() : deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function persistFollowupPlanCreate(
  db: Firestore,
  organizationId: string,
  plan: import("@/lib/types").FollowupPlan,
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    leadId: plan.leadId,
    ownerId: plan.ownerId,
    ownerManagerIds: await resolveOwnerManagerIdsClient(db, plan.ownerId),
    status: plan.status,
    planSummary: plan.planSummary,
    createdAt: plan.createdAt,
  };
  if (plan.pausedAt) data.pausedAt = plan.pausedAt;
  if (plan.pausedReason) data.pausedReason = plan.pausedReason;
  if (plan.replyMessageId) data.replyMessageId = plan.replyMessageId;
  if (plan.supersededByPlanId) data.supersededByPlanId = plan.supersededByPlanId;
  if (plan.kind) data.kind = plan.kind;
  if (plan.sequenceMode) data.sequenceMode = plan.sequenceMode;
  if (plan.channelMix) data.channelMix = plan.channelMix;
  if (plan.completedAt) data.completedAt = plan.completedAt;
  if (plan.sourceScriptId) data.sourceScriptId = plan.sourceScriptId;
  await setDoc(doc(db, COLLECTIONS.followupPlans, plan.id), data);
}

export async function persistFollowupPlanPatch(
  db: Firestore,
  planId: string,
  patch: Partial<{
    status: import("@/lib/types").FollowupPlan["status"];
    planSummary: string;
    supersededByPlanId: string;
    completedAt: string;
    /** Pass `null` to clear. */
    pausedAt: string | null;
    /** Pass `null` to clear. */
    pausedReason: string | null;
    /** Pass `null` to clear. */
    replyMessageId: string | null;
  }>,
): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.planSummary !== undefined) data.planSummary = patch.planSummary;
  if (patch.pausedAt === null) data.pausedAt = deleteField();
  else if (patch.pausedAt !== undefined) data.pausedAt = patch.pausedAt;
  if (patch.pausedReason === null) data.pausedReason = deleteField();
  else if (patch.pausedReason !== undefined) data.pausedReason = patch.pausedReason;
  if (patch.replyMessageId === null) data.replyMessageId = deleteField();
  else if (patch.replyMessageId !== undefined) data.replyMessageId = patch.replyMessageId;
  if (patch.supersededByPlanId !== undefined) data.supersededByPlanId = patch.supersededByPlanId;
  if (patch.completedAt !== undefined) data.completedAt = patch.completedAt;
  await updateDoc(doc(db, COLLECTIONS.followupPlans, planId), data);
}

export async function persistFollowupSetCompleted(
  db: Firestore,
  followupId: string,
  completed: boolean,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.followups, followupId), {
    completedAt: completed ? serverTimestamp() : deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function persistFollowupEmailSchedule(
  db: Firestore,
  followupId: string,
  schedule: {
    scheduledEmailId: string;
    emailScheduledAt: string;
    /** When set, persists whether this step starts / joins a fresh thread. */
    freshThread?: boolean;
    mailboxId?: string;
    fromEmail?: string;
    toEmail?: string;
    mailboxOwnerUid?: string;
  } | null,
): Promise<void> {
  if (schedule) {
    const mailboxId = schedule.mailboxId?.trim();
    const fromEmail = schedule.fromEmail?.trim();
    const toEmail = schedule.toEmail?.trim();
    const mailboxOwnerUid = schedule.mailboxOwnerUid?.trim();
    await updateDoc(doc(db, COLLECTIONS.followups, followupId), {
      scheduledEmailId: schedule.scheduledEmailId,
      emailScheduledAt: schedule.emailScheduledAt,
      deliveryStatus: "scheduled",
      failedAt: deleteField(),
      cancelledAt: deleteField(),
      deliveryError: deleteField(),
      cancelReason: deleteField(),
      ...(mailboxId ? { mailboxId } : {}),
      ...(fromEmail ? { fromEmail } : {}),
      ...(toEmail ? { toEmail } : {}),
      ...(mailboxOwnerUid ? { mailboxOwnerUid } : {}),
      ...(schedule.freshThread === true
        ? { freshThread: true }
        : schedule.freshThread === false
          ? { freshThread: deleteField() }
          : {}),
      updatedAt: serverTimestamp(),
    });
    return;
  }
  // Clear queue link only — keep mailboxId / fromEmail / toEmail for resume UX.
  await updateDoc(doc(db, COLLECTIONS.followups, followupId), {
    scheduledEmailId: deleteField(),
    emailScheduledAt: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export type FollowupEditablePatch = Partial<
  Pick<
    Followup,
    | "title"
    | "description"
    | "messageBody"
    | "emailSubject"
    | "channel"
    | "dueAt"
    | "priority"
    | "ownerId"
  >
>;

export async function persistFollowupPatch(
  db: Firestore,
  followupId: string,
  patch: FollowupEditablePatch,
): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) {
    data.description = patch.description.trim() ? patch.description : deleteField();
  }
  if (patch.messageBody !== undefined) {
    data.messageBody = patch.messageBody.trim() ? patch.messageBody : deleteField();
  }
  if (patch.emailSubject !== undefined) {
    data.emailSubject = patch.emailSubject.trim() ? patch.emailSubject : deleteField();
  }
  if (patch.channel !== undefined) {
    data.channel = patch.channel ? patch.channel : deleteField();
  }
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.ownerId !== undefined) {
    data.ownerId = patch.ownerId;
    data.ownerManagerIds = await resolveOwnerManagerIdsClient(db, patch.ownerId);
  }
  await updateDoc(doc(db, COLLECTIONS.followups, followupId), data);
}

export async function persistFollowupDelete(db: Firestore, followupId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.followups, followupId));
}

export async function persistLeadTaskCreate(
  db: Firestore,
  organizationId: string,
  t: LeadTask,
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    title: t.title,
    taskType: t.taskType,
    visibility: t.visibility,
    assigneeId: t.assigneeId,
    createdById: t.createdById,
    createdAt: t.createdAt,
  };
  if (t.leadId) data.leadId = t.leadId;
  if (t.description) data.description = t.description;
  if (t.dueAt) data.dueAt = t.dueAt;
  if (t.completedAt) data.completedAt = t.completedAt;
  if (t.contextCompany) data.contextCompany = t.contextCompany;
  if (t.contextContact) data.contextContact = t.contextContact;
  if (t.source) data.source = t.source;
  await setDoc(doc(db, COLLECTIONS.leadTasks, t.id), data);
}

export async function persistLeadTaskSetCompleted(
  db: Firestore,
  taskId: string,
  completed: boolean,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.leadTasks, taskId), {
    completedAt: completed ? serverTimestamp() : deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function persistTouchpointCreate(
  db: Firestore,
  organizationId: string,
  t: Touchpoint,
  leadOwnerId: string,
  opts?: { leadOwnerManagerIds?: string[] },
): Promise<void> {
  const leadOwnerManagerIds =
    opts?.leadOwnerManagerIds ?? (await resolveOwnerManagerIdsClient(db, leadOwnerId));
  await setDoc(doc(db, COLLECTIONS.touchpoints, t.id), {
    organizationId,
    leadId: t.leadId,
    leadOwnerId,
    leadOwnerManagerIds,
    channel: t.channel,
    state: t.state,
    stepNumber: t.stepNumber ?? null,
    occurredAt: t.occurredAt,
    actorId: t.actorId ?? null,
    summary: t.summary ?? null,
    payload: t.payload ?? null,
  });
}

export async function persistTimelineEventCreate(
  db: Firestore,
  organizationId: string,
  e: TimelineEvent,
  leadOwnerId: string,
  opts?: { leadOwnerManagerIds?: string[] },
): Promise<void> {
  const leadOwnerManagerIds =
    opts?.leadOwnerManagerIds ?? (await resolveOwnerManagerIdsClient(db, leadOwnerId));
  await setDoc(doc(db, COLLECTIONS.timelineEvents, e.id), {
    organizationId,
    leadId: e.leadId,
    leadOwnerId,
    leadOwnerManagerIds,
    type: e.type,
    actorId: e.actorId ?? null,
    summary: e.summary,
    payload: e.payload ?? null,
    createdAt: e.createdAt,
  });
}

export async function persistLeadActivityBump(db: Firestore, leadId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.leads, leadId), {
    touches: increment(1),
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Daily funnel counter rollup; visible to the org via hierarchy rules after sync. */
export async function persistActivityCounterCreate(
  db: Firestore,
  organizationId: string,
  row: ActivityCounterRow,
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    userId: row.userId,
    userManagerIds: await resolveOwnerManagerIdsClient(db, row.userId),
    channel: row.channel,
    date: row.date,
    counters: row.counters,
    createdAt: serverTimestamp(),
  };
  if (row.profileId) data.profileId = row.profileId;
  if (row.campaignId) data.campaignId = row.campaignId;
  await setDoc(doc(db, COLLECTIONS.activityCounters, row.id), data);
}

export async function persistActivityCounterDelete(db: Firestore, counterId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.activityCounters, counterId));
}

export async function persistActivityRecordDelete(db: Firestore, recordId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.activityRecords, recordId));
}

export async function persistProfileCreate(
  db: Firestore,
  organizationId: string,
  p: Profile,
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    name: p.name,
    channel: p.channel,
    ownerId: p.ownerId,
    ownerManagerIds: await resolveOwnerManagerIdsClient(db, p.ownerId),
    active: p.active ?? true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (p.notes) data.notes = p.notes;
  if (p.stackLabel?.trim()) data.stackLabel = p.stackLabel.trim();
  if (p.fitCheckCategories?.length) data.fitCheckCategories = p.fitCheckCategories;
  if (p.knowledgeLibraryIds?.length) data.knowledgeLibraryIds = p.knowledgeLibraryIds;
  if (p.knowledgeDocumentIds?.length) data.knowledgeDocumentIds = p.knowledgeDocumentIds;
  await setDoc(doc(db, COLLECTIONS.profiles, p.id), data);
}

export async function persistProfileUpdate(
  db: Firestore,
  profileId: string,
  patch: Partial<Profile>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.channel !== undefined) payload.channel = patch.channel;
  if (patch.ownerId !== undefined) {
    payload.ownerId = patch.ownerId;
    payload.ownerManagerIds = await resolveOwnerManagerIdsClient(db, patch.ownerId);
  }
  if (patch.active !== undefined) payload.active = patch.active;
  if (patch.notes !== undefined) {
    payload.notes = patch.notes && patch.notes.trim() ? patch.notes : deleteField();
  }
  if (patch.stackLabel !== undefined) {
    payload.stackLabel =
      patch.stackLabel && patch.stackLabel.trim() ? patch.stackLabel.trim() : deleteField();
  }
  if (patch.fitCheckCategories !== undefined) {
    payload.fitCheckCategories =
      patch.fitCheckCategories.length > 0 ? patch.fitCheckCategories : deleteField();
  }
  if (patch.knowledgeLibraryIds !== undefined) {
    payload.knowledgeLibraryIds =
      patch.knowledgeLibraryIds.length > 0 ? patch.knowledgeLibraryIds : deleteField();
  }
  if (patch.knowledgeDocumentIds !== undefined) {
    payload.knowledgeDocumentIds =
      patch.knowledgeDocumentIds.length > 0 ? patch.knowledgeDocumentIds : deleteField();
  }
  await updateDoc(doc(db, COLLECTIONS.profiles, profileId), payload);
}

export async function persistCampaignCreate(
  db: Firestore,
  organizationId: string,
  c: Campaign,
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.campaigns, c.id), {
    organizationId,
    name: c.name,
    channel: c.channel,
    status: c.status,
    externalRef: c.externalRef ?? null,
    instantlyId: c.instantlyId ?? null,
    startedAt: c.startedAt ?? null,
    lastSyncedAt: c.lastSyncedAt ?? null,
    sequenceSummary: c.sequenceSummary ?? null,
    stats: c.stats,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function persistCampaignUpdate(
  db: Firestore,
  campaignId: string,
  patch: Partial<Campaign>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.channel !== undefined) payload.channel = patch.channel;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.externalRef !== undefined) payload.externalRef = patch.externalRef ?? deleteField();
  if (patch.instantlyId !== undefined) payload.instantlyId = patch.instantlyId ?? deleteField();
  if (patch.startedAt !== undefined) payload.startedAt = patch.startedAt ?? deleteField();
  if (patch.lastSyncedAt !== undefined) payload.lastSyncedAt = patch.lastSyncedAt ?? deleteField();
  if (patch.sequenceSummary !== undefined) payload.sequenceSummary = patch.sequenceSummary ?? deleteField();
  if (patch.stats !== undefined) payload.stats = patch.stats;
  await updateDoc(doc(db, COLLECTIONS.campaigns, campaignId), payload);
}

export async function persistWorkspaceChatChannelCreate(
  db: Firestore,
  organizationId: string,
  ch: WorkspaceChatChannel,
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    kind: ch.kind,
    slug: ch.slug,
    name: ch.name,
    createdById: ch.createdById,
    createdAt: ch.createdAt,
    updatedAt: serverTimestamp(),
  };
  if (ch.memberIds?.length) data.memberIds = ch.memberIds;
  await setDoc(doc(db, COLLECTIONS.workspaceChatChannels, ch.id), data);
}

export async function persistWorkspaceChatMessageCreate(
  db: Firestore,
  organizationId: string,
  msg: WorkspaceChatMessage,
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    channelId: msg.channelId,
    authorId: msg.authorId,
    body: msg.body,
    createdAt: msg.createdAt,
  };
  if (msg.mentionUserIds?.length) data.mentionUserIds = msg.mentionUserIds;
  await setDoc(doc(db, COLLECTIONS.workspaceChatMessages, msg.id), data);
}

export async function persistWorkspaceChatChannelUpdateName(
  db: Firestore,
  channelId: string,
  name: string,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.workspaceChatChannels, channelId), {
    name,
    updatedAt: serverTimestamp(),
  });
}

/** Merge-updates last-read for one channel (and ensures parent doc fields exist). */
export async function persistWorkspaceChatChannelLastRead(
  db: Firestore,
  organizationId: string,
  userId: string,
  channelId: string,
  readThroughIso: string,
): Promise<void> {
  const readDocId = `${organizationId}__${userId}`;
  await setDoc(
    doc(db, COLLECTIONS.workspaceChatReads, readDocId),
    {
      organizationId,
      userId,
      channels: { [channelId]: readThroughIso },
    },
    { merge: true },
  );
}
