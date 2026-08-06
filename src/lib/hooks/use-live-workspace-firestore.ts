"use client";

import * as React from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import { normalizeFeatureGrants } from "@/lib/admin-feature-access";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type {
  Account,
  ActivityCounterRow,
  ActivityRecord,
  ChannelKey,
  Contact,
  Deal,
  Followup,
  FollowupPlan,
  Lead,
  LeadTask,
  Note,
  OrgActivityEvent,
  Role,
  Touchpoint,
  TimelineEvent,
  User,
  Profile,
  Campaign,
  CrmLabel,
} from "@/lib/types";
import { OPPORTUNITY_SOURCE_TYPES } from "@/lib/ai/opportunity-fit-types";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import type { WorkspaceListenerGroup } from "@/lib/workspace-listener-groups";
import {
  CORE_WORKSPACE_GROUPS,
  workspaceGroupsKey,
} from "@/lib/workspace-listener-groups";

/** Cap history listeners so WebChannel does not load unbounded org history into every client. */
const ACTIVITY_RECORDS_LIVE_LIMIT = 200;
const ORG_ACTIVITY_EVENTS_LIVE_LIMIT = 120;
const TIMELINE_EVENTS_LIVE_LIMIT = 400;

/** Collections that must arrive before CRM pages leave the loading skeleton. */
export type LiveWorkspaceCoreKey = "users" | "leads" | "followups";

export type LiveWorkspaceCoreReady = Record<LiveWorkspaceCoreKey, boolean>;

export type LiveWorkspaceFirestoreState = {
  loading: boolean;
  /** Per-collection first snapshot received (success or empty). */
  coreReady: LiveWorkspaceCoreReady;
  error: Error | null;
  users: User[];
  leads: Lead[];
  accounts: Account[];
  contacts: Contact[];
  deals: Deal[];
  notes: Note[];
  followups: Followup[];
  followupPlans: FollowupPlan[];
  leadTasks: LeadTask[];
  touchpoints: Touchpoint[];
  timelineEvents: TimelineEvent[];
  activityCounters: ActivityCounterRow[];
  activityRecords: ActivityRecord[];
  orgActivityEvents: OrgActivityEvent[];
  profiles: Profile[];
  campaigns: Campaign[];
  crmLabels: CrmLabel[];
};

const coreReadyEmpty: LiveWorkspaceCoreReady = {
  users: false,
  leads: false,
  followups: false,
};

const empty: LiveWorkspaceFirestoreState = {
  loading: true,
  coreReady: coreReadyEmpty,
  error: null,
  users: [],
  leads: [],
  accounts: [],
  contacts: [],
  deals: [],
  notes: [],
  followups: [],
  followupPlans: [],
  leadTasks: [],
  touchpoints: [],
  timelineEvents: [],
  activityCounters: [],
  activityRecords: [],
  orgActivityEvents: [],
  profiles: [],
  campaigns: [],
  crmLabels: [],
};

function isCoreKey(key: string): key is LiveWorkspaceCoreKey {
  return key === "users" || key === "leads" || key === "followups";
}

function coreLoadingComplete(ready: LiveWorkspaceCoreReady): boolean {
  return ready.users && ready.leads && ready.followups;
}

function asUser(id: string, raw: Record<string, unknown>): User {
  return {
    id,
    email: String(raw.email ?? ""),
    displayName: String(raw.displayName ?? raw.email ?? id),
    photoURL: typeof raw.photoURL === "string" ? raw.photoURL : undefined,
    roleId: (raw.roleId as Role) ?? "salesperson",
    departmentId: typeof raw.departmentId === "string" ? raw.departmentId : undefined,
    managerId: typeof raw.managerId === "string" ? raw.managerId : undefined,
    managerAncestorIds: Array.isArray(raw.managerAncestorIds)
      ? raw.managerAncestorIds.filter((id): id is string => typeof id === "string")
      : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    isSuperAdmin: Boolean(raw.isSuperAdmin),
    company: typeof raw.company === "string" ? raw.company : undefined,
    organizationId: typeof raw.organizationId === "string" ? raw.organizationId : undefined,
    orgRole: raw.orgRole as User["orgRole"],
    featureGrants: normalizeFeatureGrants(raw.featureGrants),
    status: (raw.status as User["status"]) ?? "active",
    createdAt: firestoreValueToIso(raw.createdAt),
  };
}

function asLead(id: string, raw: Record<string, unknown>): Lead {
  return mapLeadDoc(id, raw);
}

function asAccount(id: string, raw: Record<string, unknown>): Account {
  const base = { ...raw, id } as unknown as Account;
  return {
    ...base,
    id,
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
  };
}

function asContact(id: string, raw: Record<string, unknown>): Contact {
  const base = { ...raw, id } as unknown as Contact;
  return {
    ...base,
    id,
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
    emailBouncedAt: raw.emailBouncedAt ? firestoreValueToIso(raw.emailBouncedAt) : undefined,
  };
}

function asDeal(id: string, raw: Record<string, unknown>): Deal {
  const base = { ...raw, id } as unknown as Deal;
  return {
    ...base,
    id,
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
    expectedCloseDate:
      typeof raw.expectedCloseDate === "string"
        ? raw.expectedCloseDate
        : firestoreValueToIso(raw.expectedCloseDate),
    wonAt: raw.wonAt ? firestoreValueToIso(raw.wonAt) : undefined,
    lostAt: raw.lostAt ? firestoreValueToIso(raw.lostAt) : undefined,
  };
}

function optionalNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function asCrmLabel(id: string, raw: Record<string, unknown>): CrmLabel {
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    name: String(raw.name ?? ""),
    color: optionalNonEmptyString(raw.color),
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
  };
}

function asProfile(id: string, raw: Record<string, unknown>): Profile {
  const fitRaw = raw.fitCheckCategories;
  const fitCheckCategories = Array.isArray(fitRaw)
    ? fitRaw.filter(
        (c): c is OpportunitySourceType =>
          typeof c === "string" && (OPPORTUNITY_SOURCE_TYPES as readonly string[]).includes(c),
      )
    : undefined;

  const libRaw = raw.knowledgeLibraryIds;
  const knowledgeLibraryIds = Array.isArray(libRaw)
    ? libRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;

  const docRaw = raw.knowledgeDocumentIds;
  const knowledgeDocumentIds = Array.isArray(docRaw)
    ? docRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;

  return {
    id,
    name: String(raw.name ?? ""),
    channel: (raw.channel as Profile["channel"]) ?? "cold_email",
    ownerId: String(raw.ownerId ?? ""),
    active: raw.active !== false,
    notes: optionalNonEmptyString(raw.notes),
    stackLabel: optionalNonEmptyString(raw.stackLabel),
    fitCheckCategories: fitCheckCategories?.length ? fitCheckCategories : undefined,
    knowledgeLibraryIds: knowledgeLibraryIds?.length ? knowledgeLibraryIds : undefined,
    knowledgeDocumentIds: knowledgeDocumentIds?.length ? knowledgeDocumentIds : undefined,
  };
}

function asCampaign(id: string, raw: Record<string, unknown>): Campaign {
  const statsRaw = raw.stats;
  const stats =
    statsRaw && typeof statsRaw === "object" && !Array.isArray(statsRaw)
      ? (statsRaw as Campaign["stats"])
      : { sent: 0, replied: 0, meetings: 0, closed: 0 };
  return {
    id,
    name: String(raw.name ?? ""),
    channel: (raw.channel as Campaign["channel"]) ?? "cold_email",
    status: (raw.status as Campaign["status"]) ?? "draft",
    externalRef: optionalNonEmptyString(raw.externalRef),
    instantlyId: optionalNonEmptyString(raw.instantlyId),
    startedAt: raw.startedAt ? firestoreValueToIso(raw.startedAt) : undefined,
    lastSyncedAt: raw.lastSyncedAt ? firestoreValueToIso(raw.lastSyncedAt) : undefined,
    sequenceSummary:
      raw.sequenceSummary && typeof raw.sequenceSummary === "object"
        ? (raw.sequenceSummary as Campaign["sequenceSummary"])
        : undefined,
    stats,
  };
}

function asNote(id: string, raw: Record<string, unknown>): Note {
  return {
    id,
    leadId: optionalNonEmptyString(raw.leadId),
    contactId: optionalNonEmptyString(raw.contactId),
    accountId: optionalNonEmptyString(raw.accountId),
    dealId: optionalNonEmptyString(raw.dealId),
    authorId: String(raw.authorId ?? ""),
    body: String(raw.body ?? ""),
    createdAt: firestoreValueToIso(raw.createdAt),
    pinned: Boolean(raw.pinned),
  };
}

function asFollowup(id: string, raw: Record<string, unknown>): Followup {
  const rawBody = typeof raw.messageBody === "string" ? raw.messageBody : undefined;
  const hasMessageBody = Boolean(rawBody?.trim());
  return {
    id,
    leadId: optionalNonEmptyString(raw.leadId),
    dealId: optionalNonEmptyString(raw.dealId),
    contactId: optionalNonEmptyString(raw.contactId),
    title: String(raw.title ?? ""),
    description: typeof raw.description === "string" ? raw.description : undefined,
    dueAt: firestoreValueToIso(raw.dueAt),
    completedAt: raw.completedAt ? firestoreValueToIso(raw.completedAt) : undefined,
    ownerId: String(raw.ownerId ?? ""),
    priority: (raw.priority as Followup["priority"]) ?? "medium",
    auto: Boolean(raw.auto),
    // Omit full email HTML from live CRM React state — hydrate on send/edit.
    messageBody: undefined,
    hasMessageBody: hasMessageBody || undefined,
    emailSubject: typeof raw.emailSubject === "string" ? raw.emailSubject : undefined,
    channel: typeof raw.channel === "string" ? (raw.channel as Followup["channel"]) : undefined,
    planId: typeof raw.planId === "string" ? raw.planId : undefined,
    aiGenerated: Boolean(raw.aiGenerated),
    pausedAt: raw.pausedAt ? firestoreValueToIso(raw.pausedAt) : undefined,
    scheduledEmailId:
      typeof raw.scheduledEmailId === "string" && raw.scheduledEmailId.trim()
        ? raw.scheduledEmailId.trim()
        : undefined,
    emailScheduledAt: raw.emailScheduledAt
      ? firestoreValueToIso(raw.emailScheduledAt)
      : undefined,
    mailboxId:
      typeof raw.mailboxId === "string" && raw.mailboxId.trim()
        ? raw.mailboxId.trim()
        : undefined,
    fromEmail:
      typeof raw.fromEmail === "string" && raw.fromEmail.trim()
        ? raw.fromEmail.trim()
        : undefined,
    toEmail:
      typeof raw.toEmail === "string" && raw.toEmail.trim()
        ? raw.toEmail.trim()
        : undefined,
    mailboxOwnerUid:
      typeof raw.mailboxOwnerUid === "string" && raw.mailboxOwnerUid.trim()
        ? raw.mailboxOwnerUid.trim()
        : undefined,
    deliveryStatus:
      raw.deliveryStatus === "scheduled" ||
      raw.deliveryStatus === "sent" ||
      raw.deliveryStatus === "failed" ||
      raw.deliveryStatus === "cancelled" ||
      raw.deliveryStatus === "needs_retry"
        ? raw.deliveryStatus
        : undefined,
    sentAt: raw.sentAt ? firestoreValueToIso(raw.sentAt) : undefined,
    sentMessageId:
      typeof raw.sentMessageId === "string" && raw.sentMessageId.trim()
        ? raw.sentMessageId.trim()
        : undefined,
    freshThread: raw.freshThread === true ? true : undefined,
    failedAt: raw.failedAt ? firestoreValueToIso(raw.failedAt) : undefined,
    cancelledAt: raw.cancelledAt ? firestoreValueToIso(raw.cancelledAt) : undefined,
    deliveryError: typeof raw.deliveryError === "string" ? raw.deliveryError : undefined,
    cancelReason: typeof raw.cancelReason === "string" ? raw.cancelReason : undefined,
    deliveryAttempts:
      Number.isFinite(Number(raw.deliveryAttempts)) && Number(raw.deliveryAttempts) > 0
        ? Math.floor(Number(raw.deliveryAttempts))
        : undefined,
    nextRetryAt: raw.nextRetryAt ? firestoreValueToIso(raw.nextRetryAt) : undefined,
  };
}

function asFollowupPlan(id: string, raw: Record<string, unknown>): FollowupPlan {
  return {
    id,
    leadId: String(raw.leadId ?? ""),
    ownerId: String(raw.ownerId ?? ""),
    status: (raw.status as FollowupPlan["status"]) ?? "active",
    planSummary: String(raw.planSummary ?? ""),
    createdAt: firestoreValueToIso(raw.createdAt),
    kind: raw.kind === "sequence" ? "sequence" : undefined,
    sequenceMode:
      raw.sequenceMode === "full" || raw.sequenceMode === "continue"
        ? raw.sequenceMode
        : undefined,
    channelMix:
      raw.channelMix === "lead" ||
      raw.channelMix === "email" ||
      raw.channelMix === "linkedin" ||
      raw.channelMix === "multi_channel"
        ? raw.channelMix
        : undefined,
    pausedAt: raw.pausedAt ? firestoreValueToIso(raw.pausedAt) : undefined,
    pausedReason: typeof raw.pausedReason === "string" ? raw.pausedReason : undefined,
    replyMessageId: typeof raw.replyMessageId === "string" ? raw.replyMessageId : undefined,
    supersededByPlanId:
      typeof raw.supersededByPlanId === "string" ? raw.supersededByPlanId : undefined,
    completedAt: raw.completedAt ? firestoreValueToIso(raw.completedAt) : undefined,
    sourceScriptId:
      typeof raw.sourceScriptId === "string" && raw.sourceScriptId.trim()
        ? raw.sourceScriptId.trim()
        : undefined,
  };
}

function asLeadTask(id: string, raw: Record<string, unknown>): LeadTask {
  return {
    id,
    leadId: optionalNonEmptyString(raw.leadId),
    title: String(raw.title ?? ""),
    description: typeof raw.description === "string" ? raw.description : undefined,
    taskType: (raw.taskType as LeadTask["taskType"]) ?? "other",
    visibility: (raw.visibility as LeadTask["visibility"]) ?? "on_lead",
    assigneeId: String(raw.assigneeId ?? ""),
    createdById: String(raw.createdById ?? ""),
    dueAt: raw.dueAt ? firestoreValueToIso(raw.dueAt) : undefined,
    completedAt: raw.completedAt ? firestoreValueToIso(raw.completedAt) : undefined,
    createdAt: firestoreValueToIso(raw.createdAt),
    contextCompany: optionalNonEmptyString(raw.contextCompany),
    contextContact: optionalNonEmptyString(raw.contextContact),
    source:
      raw.source === "email_bounce" || raw.source === "manual" || raw.source === "system"
        ? raw.source
        : undefined,
  };
}

function asTouchpoint(id: string, raw: Record<string, unknown>): Touchpoint {
  return {
    id,
    leadId: String(raw.leadId ?? ""),
    channel: raw.channel as Touchpoint["channel"],
    state: String(raw.state ?? ""),
    stepNumber: typeof raw.stepNumber === "number" ? raw.stepNumber : undefined,
    occurredAt: firestoreValueToIso(raw.occurredAt),
    actorId: typeof raw.actorId === "string" ? raw.actorId : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    payload:
      raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
        ? (raw.payload as Record<string, unknown>)
        : undefined,
  };
}

function asTimelineEvent(id: string, raw: Record<string, unknown>): TimelineEvent {
  return {
    id,
    leadId: String(raw.leadId ?? ""),
    leadOwnerId: typeof raw.leadOwnerId === "string" ? raw.leadOwnerId : undefined,
    type: raw.type as TimelineEvent["type"],
    actorId: typeof raw.actorId === "string" ? raw.actorId : undefined,
    summary: String(raw.summary ?? ""),
    payload:
      raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
        ? (raw.payload as Record<string, unknown>)
        : undefined,
    createdAt: firestoreValueToIso(raw.createdAt),
  };
}

function asActivityCounterRow(id: string, raw: Record<string, unknown>): ActivityCounterRow {
  const countersRaw = raw.counters;
  const counters: Record<string, number> = {};
  if (countersRaw && typeof countersRaw === "object" && !Array.isArray(countersRaw)) {
    for (const [k, v] of Object.entries(countersRaw as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) counters[k] = n;
    }
  }
  return {
    id,
    userId: String(raw.userId ?? ""),
    channel: String(raw.channel ?? "cold_email") as ChannelKey,
    profileId: optionalNonEmptyString(raw.profileId),
    campaignId: optionalNonEmptyString(raw.campaignId),
    date: firestoreValueToIso(raw.date),
    counters,
  };
}

function asActivityRecord(id: string, raw: Record<string, unknown>): ActivityRecord {
  const metadataRaw = raw.metadata;
  return {
    id,
    userId: String(raw.userId ?? ""),
    channel: String(raw.channel ?? "cold_email") as ChannelKey,
    profileId: optionalNonEmptyString(raw.profileId),
    leadId: optionalNonEmptyString(raw.leadId),
    type: String(raw.type ?? "activity"),
    occurredAt: firestoreValueToIso(raw.occurredAt),
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    metadata:
      metadataRaw && typeof metadataRaw === "object" && !Array.isArray(metadataRaw)
        ? (metadataRaw as Record<string, unknown>)
        : undefined,
  };
}

function asOrgActivityEvent(id: string, raw: Record<string, unknown>): OrgActivityEvent {
  return {
    id,
    organizationId: typeof raw.organizationId === "string" ? raw.organizationId : undefined,
    type: raw.type as OrgActivityEvent["type"],
    actorId: String(raw.actorId ?? ""),
    summary: String(raw.summary ?? ""),
    createdAt: firestoreValueToIso(raw.createdAt),
    href: typeof raw.href === "string" ? raw.href : undefined,
    entityType: typeof raw.entityType === "string" ? raw.entityType : undefined,
    entityId: typeof raw.entityId === "string" ? raw.entityId : undefined,
    payload:
      raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
        ? (raw.payload as Record<string, unknown>)
        : undefined,
  };
}

/**
 * Real-time tenant CRM documents for live workspace mode.
 *
 * Listener groups attach on first request and stay attached for the session
 * (sticky). Full teardown only on org / viewer / scope change or unmount.
 *
 * @param narrowToMemberCrm When true, queries only rows the signed-in user owns / is assigned to
 *   (list rules cannot use hierarchy get(); managers open report docs via get by id).
 * @param _viewerForMemberScope Kept for call-site compatibility; list queries use viewerUid only.
 * @param requestedGroups Sticky set of listener groups to attach (always includes core).
 */
export function useLiveWorkspaceFirestore(
  organizationId: string | undefined,
  viewerUid: string | undefined,
  narrowToMemberCrm: boolean,
  _viewerForMemberScope?: User | null,
  requestedGroups: ReadonlySet<WorkspaceListenerGroup> = CORE_WORKSPACE_GROUPS,
): LiveWorkspaceFirestoreState {
  const [state, setState] = React.useState<LiveWorkspaceFirestoreState>(empty);
  /** One entry per listener; cleared on that listener’s success so the banner can recover after transient errors. */
  const listenerErrorsRef = React.useRef(new Map<string, Error>());
  const attachedGroupsRef = React.useRef(new Set<WorkspaceListenerGroup>());
  const groupUnsubsRef = React.useRef(new Map<WorkspaceListenerGroup, Unsubscribe[]>());
  const sessionRef = React.useRef<{
    organizationId: string;
    viewerUid: string | undefined;
    narrowToMemberCrm: boolean;
    attachGroup: (group: WorkspaceListenerGroup) => void;
  } | null>(null);

  const groupsKey = workspaceGroupsKey(requestedGroups);

  // Tear down / rebuild subscription session when org, viewer, or member scope changes.
  React.useEffect(() => {
    attachedGroupsRef.current.clear();
    for (const unsubs of groupUnsubsRef.current.values()) {
      for (const u of unsubs) u();
    }
    groupUnsubsRef.current.clear();
    sessionRef.current = null;
    listenerErrorsRef.current.clear();

    if (!isFirebaseWebConfigured()) {
      setState({
        loading: false,
        coreReady: { users: true, leads: true, followups: true },
        error: null,
        users: [],
        leads: [],
        accounts: [],
        contacts: [],
        deals: [],
        notes: [],
        followups: [],
        followupPlans: [],
        leadTasks: [],
        touchpoints: [],
        timelineEvents: [],
        activityCounters: [],
        activityRecords: [],
        orgActivityEvents: [],
        profiles: [],
        campaigns: [],
        crmLabels: [],
      });
      return;
    }

    // Wait for organizationId (userDoc still hydrating). Marking core ready with
    // empty arrays here caused a false "No leads / empty workspace" flash.
    if (!organizationId) {
      setState({
        loading: true,
        coreReady: coreReadyEmpty,
        error: null,
        users: [],
        leads: [],
        accounts: [],
        contacts: [],
        deals: [],
        notes: [],
        followups: [],
        followupPlans: [],
        leadTasks: [],
        touchpoints: [],
        timelineEvents: [],
        activityCounters: [],
        activityRecords: [],
        orgActivityEvents: [],
        profiles: [],
        campaigns: [],
        crmLabels: [],
      });
      return;
    }

    let db: ReturnType<typeof getFirebaseDb>;
    try {
      db = getFirebaseDb();
    } catch (e) {
      setState({
        loading: false,
        coreReady: { users: true, leads: true, followups: true },
        error: e instanceof Error ? e : new Error(String(e)),
        users: [],
        leads: [],
        accounts: [],
        contacts: [],
        deals: [],
        notes: [],
        followups: [],
        followupPlans: [],
        leadTasks: [],
        touchpoints: [],
        timelineEvents: [],
        activityCounters: [],
        activityRecords: [],
        orgActivityEvents: [],
        profiles: [],
        campaigns: [],
        crmLabels: [],
      });
      return;
    }

    setState((s) => ({
      ...s,
      loading: true,
      coreReady: coreReadyEmpty,
      error: null,
      accounts: [],
      contacts: [],
      deals: [],
      notes: [],
      followupPlans: [],
      touchpoints: [],
      timelineEvents: [],
      activityCounters: [],
      activityRecords: [],
      orgActivityEvents: [],
      profiles: [],
      campaigns: [],
    }));

    const memberScope = Boolean(narrowToMemberCrm && viewerUid);
    const uid = viewerUid ?? "";
    const listOwnerId = uid;

    const firstAggregateError = (): Error | null => {
      const entries = [...listenerErrorsRef.current.entries()];
      if (entries.length === 0) return null;
      const lines = entries.map(([key, err]) => {
        const msg = err.message?.trim() || err.name || "Unknown error";
        return `${key}: ${msg}`;
      });
      return new Error(lines.join(" | "));
    };

    /** Coalesce bursty onSnapshot updates into one React commit per microtask. */
    let pendingPatch: Partial<LiveWorkspaceFirestoreState> = {};
    let pendingCore: Partial<LiveWorkspaceCoreReady> = {};
    let flushScheduled = false;
    let snapshotBatchCancelled = false;

    const flushPendingSnapshots = () => {
      flushScheduled = false;
      if (snapshotBatchCancelled) return;
      const patch = pendingPatch;
      const core = pendingCore;
      pendingPatch = {};
      pendingCore = {};
      if (Object.keys(patch).length === 0 && Object.keys(core).length === 0) {
        // Error-only flush still needs to refresh the banner.
        setState((prev) => ({
          ...prev,
          error: firstAggregateError(),
          loading: !coreLoadingComplete(prev.coreReady),
        }));
        return;
      }
      setState((prev) => {
        const nextCore = { ...prev.coreReady, ...core };
        return {
          ...prev,
          ...patch,
          coreReady: nextCore,
          loading: !coreLoadingComplete(nextCore),
          error: firstAggregateError(),
        };
      });
    };

    const scheduleSnapshotFlush = () => {
      if (flushScheduled || snapshotBatchCancelled) return;
      flushScheduled = true;
      queueMicrotask(flushPendingSnapshots);
    };

    const applySnapshot = <K extends keyof LiveWorkspaceFirestoreState>(
      listenerKey: string,
      dataKey: K,
      value: LiveWorkspaceFirestoreState[K],
    ) => {
      listenerErrorsRef.current.delete(listenerKey);
      pendingPatch[dataKey] = value;
      if (isCoreKey(String(dataKey))) {
        pendingCore[String(dataKey) as LiveWorkspaceCoreKey] = true;
      }
      scheduleSnapshotFlush();
    };

    const applyListenerError = (listenerKey: string, err: Error) => {
      listenerErrorsRef.current.set(listenerKey, err);
      const baseKey = listenerKey.split(":")[0] ?? listenerKey;
      if (isCoreKey(baseKey)) {
        pendingCore[baseKey] = true;
      }
      scheduleSnapshotFlush();
    };

    const pushUnsub = (group: WorkspaceListenerGroup, unsub: Unsubscribe) => {
      const list = groupUnsubsRef.current.get(group) ?? [];
      list.push(unsub);
      groupUnsubsRef.current.set(group, list);
    };

    const subscribeOwnedByOwnerOrManager = <K extends keyof LiveWorkspaceFirestoreState>(
      group: WorkspaceListenerGroup,
      dataKey: K,
      collectionName: string,
      mapDoc: (id: string, raw: Record<string, unknown>) => LiveWorkspaceFirestoreState[K] extends (infer R)[]
        ? R
        : never,
      managerField: "ownerManagerIds" | "leadOwnerManagerIds" | "userManagerIds",
      ownerField: "ownerId" | "leadOwnerId" | "userId",
      opts?: {
        orderByField?: string;
        limitCount?: number;
      },
    ) => {
      type Row = LiveWorkspaceFirestoreState[K] extends (infer R)[] ? R : never;
      const withCap = (constraints: QueryConstraint[]) => {
        const next = [...constraints];
        if (opts?.orderByField) next.push(orderBy(opts.orderByField, "desc"));
        if (opts?.limitCount) next.push(limit(opts.limitCount));
        return next;
      };
      if (!memberScope) {
        pushUnsub(
          group,
          onSnapshot(
            query(
              collection(db, collectionName),
              ...withCap([where("organizationId", "==", organizationId)]),
            ),
            (snap) => {
              applySnapshot(
                String(dataKey),
                dataKey,
                snap.docs.map((d) =>
                  mapDoc(d.id, d.data() as Record<string, unknown>),
                ) as unknown as LiveWorkspaceFirestoreState[K],
              );
            },
            (err) => applyListenerError(String(dataKey), err),
          ),
        );
        return;
      }
      const slices = new Map<string, Row[]>();
      const merge = () => {
        const byId = new Map<string, Row>();
        for (const slice of slices.values()) {
          for (const row of slice) {
            const id = (row as { id: string }).id;
            byId.set(id, row);
          }
        }
        applySnapshot(
          String(dataKey),
          dataKey,
          Array.from(byId.values()) as unknown as LiveWorkspaceFirestoreState[K],
        );
      };
      const sub = (key: string, constraints: QueryConstraint[]) => {
        pushUnsub(
          group,
          onSnapshot(
            query(collection(db, collectionName), ...withCap(constraints)),
            (snap) => {
              slices.set(
                key,
                snap.docs.map((d) =>
                  mapDoc(d.id, d.data() as Record<string, unknown>),
                ) as Row[],
              );
              merge();
            },
            (err) => applyListenerError(`${String(dataKey)}:${key}`, err),
          ),
        );
      };
      sub("owner", [
        where("organizationId", "==", organizationId),
        where(ownerField, "==", listOwnerId),
      ]);
      sub("managers", [
        where("organizationId", "==", organizationId),
        where(managerField, "array-contains", uid),
      ]);
    };

    const attachGroup = (group: WorkspaceListenerGroup) => {
      if (attachedGroupsRef.current.has(group)) return;
      attachedGroupsRef.current.add(group);

      if (group === "core") {
        const qUsers = query(
          collection(db, COLLECTIONS.users),
          where("organizationId", "==", organizationId),
        );
        pushUnsub(
          group,
          onSnapshot(
            qUsers,
            (snap) => {
              const users = snap.docs.map((d) => asUser(d.id, d.data() as Record<string, unknown>));
              applySnapshot("users", "users", users);
            },
            (err) => applyListenerError("users", err),
          ),
        );

        const leadSlices = new Map<string, Lead[]>();
        const mergeLeadSlices = () => {
          const byId = new Map<string, Lead>();
          for (const slice of leadSlices.values()) {
            for (const lead of slice) {
              byId.set(lead.id, lead);
            }
          }
          applySnapshot("leads", "leads", Array.from(byId.values()));
        };
        const subscribeLeads = (key: string, q: ReturnType<typeof query>) => {
          pushUnsub(
            group,
            onSnapshot(
              q,
              (snap) => {
                leadSlices.set(
                  key,
                  snap.docs.map((d) => asLead(d.id, d.data() as Record<string, unknown>)),
                );
                mergeLeadSlices();
              },
              (err) => applyListenerError(`leads:${key}`, err),
            ),
          );
        };
        if (memberScope) {
          subscribeLeads(
            "owner",
            query(
              collection(db, COLLECTIONS.leads),
              where("organizationId", "==", organizationId),
              where("ownerId", "==", listOwnerId),
            ),
          );
          subscribeLeads(
            "managers",
            query(
              collection(db, COLLECTIONS.leads),
              where("organizationId", "==", organizationId),
              where("ownerManagerIds", "array-contains", uid),
            ),
          );
          subscribeLeads(
            "prospectAssignee",
            query(
              collection(db, COLLECTIONS.leads),
              where("organizationId", "==", organizationId),
              where("intakeKind", "==", "prospect"),
              where("prospectAssigneeIds", "array-contains", uid),
            ),
          );
          subscribeLeads(
            "sharedOwner",
            query(
              collection(db, COLLECTIONS.leads),
              where("organizationId", "==", organizationId),
              where("sharedOwnerIds", "array-contains", uid),
            ),
          );
        } else {
          subscribeLeads(
            "all",
            query(collection(db, COLLECTIONS.leads), where("organizationId", "==", organizationId)),
          );
        }

        subscribeOwnedByOwnerOrManager(
          group,
          "followups",
          COLLECTIONS.followups,
          asFollowup,
          "ownerManagerIds",
          "ownerId",
        );

        const leadTaskSlices = new Map<string, LeadTask[]>();
        const mergeLeadTaskSlices = () => {
          const byId = new Map<string, LeadTask>();
          for (const slice of leadTaskSlices.values()) {
            for (const task of slice) {
              byId.set(task.id, task);
            }
          }
          applySnapshot("leadTasks", "leadTasks", Array.from(byId.values()));
        };
        const subscribeLeadTasks = (key: string, q: ReturnType<typeof query>) => {
          pushUnsub(
            group,
            onSnapshot(
              q,
              (snap) => {
                leadTaskSlices.set(
                  key,
                  snap.docs.map((d) => asLeadTask(d.id, d.data() as Record<string, unknown>)),
                );
                mergeLeadTaskSlices();
              },
              (err) => applyListenerError(`leadTasks:${key}`, err),
            ),
          );
        };
        if (memberScope) {
          subscribeLeadTasks(
            "assignee",
            query(
              collection(db, COLLECTIONS.leadTasks),
              where("organizationId", "==", organizationId),
              where("assigneeId", "==", listOwnerId),
            ),
          );
          subscribeLeadTasks(
            "createdBy",
            query(
              collection(db, COLLECTIONS.leadTasks),
              where("organizationId", "==", organizationId),
              where("createdById", "==", listOwnerId),
            ),
          );
        } else {
          subscribeLeadTasks(
            "all",
            query(
              collection(db, COLLECTIONS.leadTasks),
              where("organizationId", "==", organizationId),
            ),
          );
        }

        const qLabels = query(
          collection(db, COLLECTIONS.labels),
          where("organizationId", "==", organizationId),
        );
        pushUnsub(
          group,
          onSnapshot(
            qLabels,
            (snap) => {
              const crmLabels = snap.docs.map((d) =>
                asCrmLabel(d.id, d.data() as Record<string, unknown>),
              );
              applySnapshot("crmLabels", "crmLabels", crmLabels);
            },
            (err) => applyListenerError("crmLabels", err),
          ),
        );
        return;
      }

      if (group === "directory") {
        subscribeOwnedByOwnerOrManager(
          group,
          "accounts",
          COLLECTIONS.accounts,
          asAccount,
          "ownerManagerIds",
          "ownerId",
        );
        subscribeOwnedByOwnerOrManager(
          group,
          "contacts",
          COLLECTIONS.contacts,
          asContact,
          "ownerManagerIds",
          "ownerId",
        );
        subscribeOwnedByOwnerOrManager(
          group,
          "profiles",
          COLLECTIONS.profiles,
          asProfile,
          "ownerManagerIds",
          "ownerId",
        );
        return;
      }

      if (group === "deals") {
        subscribeOwnedByOwnerOrManager(
          group,
          "deals",
          COLLECTIONS.deals,
          asDeal,
          "ownerManagerIds",
          "ownerId",
        );
        return;
      }

      if (group === "plans") {
        subscribeOwnedByOwnerOrManager(
          group,
          "followupPlans",
          COLLECTIONS.followupPlans,
          asFollowupPlan,
          "ownerManagerIds",
          "ownerId",
        );
        return;
      }

      if (group === "timeline") {
        // Capped recent events for dashboard activity feed — avoids notes/touchpoints fan-out.
        subscribeOwnedByOwnerOrManager(
          group,
          "timelineEvents",
          COLLECTIONS.timelineEvents,
          asTimelineEvent,
          "leadOwnerManagerIds",
          "leadOwnerId",
          { orderByField: "createdAt", limitCount: TIMELINE_EVENTS_LIVE_LIMIT },
        );
        return;
      }

      if (group === "leadDetail") {
        const noteSlices = new Map<string, Note[]>();
        const mergeNoteSlices = () => {
          const byId = new Map<string, Note>();
          for (const slice of noteSlices.values()) {
            for (const note of slice) {
              byId.set(note.id, note);
            }
          }
          applySnapshot("notes", "notes", Array.from(byId.values()));
        };
        const subscribeNotes = (key: string, q: ReturnType<typeof query>) => {
          pushUnsub(
            group,
            onSnapshot(
              q,
              (snap) => {
                noteSlices.set(
                  key,
                  snap.docs.map((d) => asNote(d.id, d.data() as Record<string, unknown>)),
                );
                mergeNoteSlices();
              },
              (err) => applyListenerError(`notes:${key}`, err),
            ),
          );
        };
        if (memberScope) {
          subscribeNotes(
            "author",
            query(
              collection(db, COLLECTIONS.notes),
              where("organizationId", "==", organizationId),
              where("authorId", "==", listOwnerId),
            ),
          );
          subscribeNotes(
            "leadOwner",
            query(
              collection(db, COLLECTIONS.notes),
              where("organizationId", "==", organizationId),
              where("leadOwnerId", "==", listOwnerId),
            ),
          );
          subscribeNotes(
            "managers",
            query(
              collection(db, COLLECTIONS.notes),
              where("organizationId", "==", organizationId),
              where("leadOwnerManagerIds", "array-contains", uid),
            ),
          );
        } else {
          subscribeNotes(
            "all",
            query(collection(db, COLLECTIONS.notes), where("organizationId", "==", organizationId)),
          );
        }

        subscribeOwnedByOwnerOrManager(
          group,
          "touchpoints",
          COLLECTIONS.touchpoints,
          asTouchpoint,
          "leadOwnerManagerIds",
          "leadOwnerId",
        );
        // Timeline lives in the `timeline` group (always requested with leadDetail).
        return;
      }

      if (group === "activity") {
        subscribeOwnedByOwnerOrManager(
          group,
          "activityCounters",
          COLLECTIONS.activityCounters,
          asActivityCounterRow,
          "userManagerIds",
          "userId",
        );
        subscribeOwnedByOwnerOrManager(
          group,
          "activityRecords",
          COLLECTIONS.activityRecords,
          asActivityRecord,
          "userManagerIds",
          "userId",
          { orderByField: "occurredAt", limitCount: ACTIVITY_RECORDS_LIVE_LIMIT },
        );
        const qOrgActivity = query(
          collection(db, COLLECTIONS.orgActivityEvents),
          where("organizationId", "==", organizationId),
          orderBy("createdAt", "desc"),
          limit(ORG_ACTIVITY_EVENTS_LIVE_LIMIT),
        );
        pushUnsub(
          group,
          onSnapshot(
            qOrgActivity,
            (snap) => {
              const orgActivityEvents = snap.docs.map((d) =>
                asOrgActivityEvent(d.id, d.data() as Record<string, unknown>),
              );
              applySnapshot("orgActivityEvents", "orgActivityEvents", orgActivityEvents);
            },
            (err) => applyListenerError("orgActivityEvents", err),
          ),
        );
        return;
      }

      if (group === "campaigns") {
        const qCampaigns = query(
          collection(db, COLLECTIONS.campaigns),
          where("organizationId", "==", organizationId),
        );
        pushUnsub(
          group,
          onSnapshot(
            qCampaigns,
            (snap) => {
              const campaigns = snap.docs.map((d) =>
                asCampaign(d.id, d.data() as Record<string, unknown>),
              );
              applySnapshot("campaigns", "campaigns", campaigns);
            },
            (err) => applyListenerError("campaigns", err),
          ),
        );
      }
    };

    sessionRef.current = {
      organizationId,
      viewerUid,
      narrowToMemberCrm,
      attachGroup,
    };

    // Attach whatever groups are already requested for this session.
    for (const g of requestedGroups) {
      attachGroup(g);
    }
    // Always ensure core is attached even if caller omitted it.
    attachGroup("core");

    return () => {
      snapshotBatchCancelled = true;
      listenerErrorsRef.current.clear();
      sessionRef.current = null;
      attachedGroupsRef.current.clear();
      for (const unsubs of groupUnsubsRef.current.values()) {
        for (const u of unsubs) u();
      }
      groupUnsubsRef.current.clear();
    };
    // groupsKey intentionally omitted: sticky attach is handled by the second effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, viewerUid, narrowToMemberCrm]);

  // Sticky attach: when new groups are requested, subscribe without tearing down existing ones.
  React.useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    for (const g of requestedGroups) {
      session.attachGroup(g);
    }
  }, [groupsKey, requestedGroups]);

  return state;
}
