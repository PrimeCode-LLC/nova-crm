"use client";

import * as React from "react";
import {
  and,
  collection,
  onSnapshot,
  or,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import type {
  Account,
  ActivityCounterRow,
  ActivityRecord,
  ChannelKey,
  Contact,
  Deal,
  Followup,
  Lead,
  LeadTask,
  Note,
  Role,
  Touchpoint,
  TimelineEvent,
  User,
  Profile,
  Campaign,
  CrmLabel,
} from "@/lib/types";

export type LiveWorkspaceFirestoreState = {
  loading: boolean;
  error: Error | null;
  users: User[];
  leads: Lead[];
  accounts: Account[];
  contacts: Contact[];
  deals: Deal[];
  notes: Note[];
  followups: Followup[];
  leadTasks: LeadTask[];
  touchpoints: Touchpoint[];
  timelineEvents: TimelineEvent[];
  activityCounters: ActivityCounterRow[];
  activityRecords: ActivityRecord[];
  profiles: Profile[];
  campaigns: Campaign[];
  crmLabels: CrmLabel[];
};

const empty: LiveWorkspaceFirestoreState = {
  loading: true,
  error: null,
  users: [],
  leads: [],
  accounts: [],
  contacts: [],
  deals: [],
  notes: [],
  followups: [],
  leadTasks: [],
  touchpoints: [],
  timelineEvents: [],
  activityCounters: [],
  activityRecords: [],
  profiles: [],
  campaigns: [],
  crmLabels: [],
};

function asUser(id: string, raw: Record<string, unknown>): User {
  return {
    id,
    email: String(raw.email ?? ""),
    displayName: String(raw.displayName ?? raw.email ?? id),
    photoURL: typeof raw.photoURL === "string" ? raw.photoURL : undefined,
    roleId: (raw.roleId as Role) ?? "salesperson",
    departmentId: typeof raw.departmentId === "string" ? raw.departmentId : undefined,
    managerId: typeof raw.managerId === "string" ? raw.managerId : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    isSuperAdmin: Boolean(raw.isSuperAdmin),
    company: typeof raw.company === "string" ? raw.company : undefined,
    organizationId: typeof raw.organizationId === "string" ? raw.organizationId : undefined,
    orgRole: raw.orgRole as User["orgRole"],
    status: (raw.status as User["status"]) ?? "active",
    createdAt: firestoreValueToIso(raw.createdAt),
  };
}

function asLead(id: string, raw: Record<string, unknown>): Lead {
  const base = { ...raw, id } as unknown as Lead;
  return {
    ...base,
    id,
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
  };
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
  return {
    id,
    name: String(raw.name ?? ""),
    channel: (raw.channel as Profile["channel"]) ?? "cold_email",
    ownerId: String(raw.ownerId ?? ""),
    active: raw.active !== false,
    notes: optionalNonEmptyString(raw.notes),
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
    startedAt: raw.startedAt ? firestoreValueToIso(raw.startedAt) : undefined,
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

/**
 * Real-time tenant CRM documents for live workspace mode.
 *
 * @param narrowToMemberCrm When true (workspace `orgRole == "member"`), queries only rows the user may read
 *   under tightened Firestore rules (own `ownerId` / `leadOwnerId` / task participation, etc.).
 */
export function useLiveWorkspaceFirestore(
  organizationId: string | undefined,
  viewerUid: string | undefined,
  narrowToMemberCrm: boolean,
): LiveWorkspaceFirestoreState {
  const [state, setState] = React.useState<LiveWorkspaceFirestoreState>(empty);
  /** One entry per listener; cleared on that listener’s success so the banner can recover after transient errors. */
  const listenerErrorsRef = React.useRef(new Map<string, Error>());

  React.useEffect(() => {
    if (!organizationId || !isFirebaseWebConfigured()) {
      listenerErrorsRef.current.clear();
      setState({
        loading: false,
        error: null,
        users: [],
        leads: [],
        accounts: [],
        contacts: [],
        deals: [],
        notes: [],
        followups: [],
        leadTasks: [],
        touchpoints: [],
        timelineEvents: [],
        activityCounters: [],
        activityRecords: [],
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
      listenerErrorsRef.current.clear();
      setState({
        loading: false,
        error: e instanceof Error ? e : new Error(String(e)),
        users: [],
        leads: [],
        accounts: [],
        contacts: [],
        deals: [],
        notes: [],
        followups: [],
        leadTasks: [],
        touchpoints: [],
        timelineEvents: [],
        activityCounters: [],
        activityRecords: [],
        profiles: [],
        campaigns: [],
        crmLabels: [],
      });
      return;
    }

    listenerErrorsRef.current.clear();
    setState((s) => ({ ...s, loading: true, error: null }));

    const memberScope = Boolean(narrowToMemberCrm && viewerUid);
    const uid = viewerUid ?? "";

    const firstAggregateError = (): Error | null => {
      const v = listenerErrorsRef.current.values().next();
      return v.done ? null : v.value;
    };

    const applySnapshot = <K extends keyof LiveWorkspaceFirestoreState>(
      listenerKey: string,
      dataKey: K,
      value: LiveWorkspaceFirestoreState[K],
    ) => {
      listenerErrorsRef.current.delete(listenerKey);
      setState((prev) => ({
        ...prev,
        [dataKey]: value,
        loading: false,
        error: firstAggregateError(),
      }));
    };

    const applyListenerError = (listenerKey: string, err: Error) => {
      listenerErrorsRef.current.set(listenerKey, err);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: firstAggregateError(),
      }));
    };

    const unsubs: Unsubscribe[] = [];

    const qUsers = query(
      collection(db, COLLECTIONS.users),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qUsers,
        (snap) => {
          const users = snap.docs.map((d) => asUser(d.id, d.data() as Record<string, unknown>));
          applySnapshot("users", "users", users);
        },
        (err) => applyListenerError("users", err),
      ),
    );

    const qLeads = memberScope
      ? query(
          collection(db, COLLECTIONS.leads),
          where("organizationId", "==", organizationId),
          where("ownerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.leads), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qLeads,
        (snap) => {
          const leads = snap.docs.map((d) => asLead(d.id, d.data() as Record<string, unknown>));
          applySnapshot("leads", "leads", leads);
        },
        (err) => applyListenerError("leads", err),
      ),
    );

    const qAccounts = memberScope
      ? query(
          collection(db, COLLECTIONS.accounts),
          where("organizationId", "==", organizationId),
          where("ownerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.accounts), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qAccounts,
        (snap) => {
          const accounts = snap.docs.map((d) =>
            asAccount(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("accounts", "accounts", accounts);
        },
        (err) => applyListenerError("accounts", err),
      ),
    );

    const qContacts = memberScope
      ? query(
          collection(db, COLLECTIONS.contacts),
          where("organizationId", "==", organizationId),
          where("ownerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.contacts), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qContacts,
        (snap) => {
          const contacts = snap.docs.map((d) =>
            asContact(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("contacts", "contacts", contacts);
        },
        (err) => applyListenerError("contacts", err),
      ),
    );

    const qDeals = memberScope
      ? query(
          collection(db, COLLECTIONS.deals),
          where("organizationId", "==", organizationId),
          where("ownerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.deals), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qDeals,
        (snap) => {
          const deals = snap.docs.map((d) => asDeal(d.id, d.data() as Record<string, unknown>));
          applySnapshot("deals", "deals", deals);
        },
        (err) => applyListenerError("deals", err),
      ),
    );

    const qNotes = memberScope
      ? query(
          collection(db, COLLECTIONS.notes),
          or(
            and(where("organizationId", "==", organizationId), where("authorId", "==", uid)),
            and(where("organizationId", "==", organizationId), where("leadOwnerId", "==", uid)),
          ),
        )
      : query(collection(db, COLLECTIONS.notes), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qNotes,
        (snap) => {
          const notes = snap.docs.map((d) => asNote(d.id, d.data() as Record<string, unknown>));
          applySnapshot("notes", "notes", notes);
        },
        (err) => applyListenerError("notes", err),
      ),
    );

    const qFollowups = memberScope
      ? query(
          collection(db, COLLECTIONS.followups),
          where("organizationId", "==", organizationId),
          where("ownerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.followups), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qFollowups,
        (snap) => {
          const followups = snap.docs.map((d) =>
            asFollowup(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("followups", "followups", followups);
        },
        (err) => applyListenerError("followups", err),
      ),
    );

    const qLeadTasks = memberScope
      ? query(
          collection(db, COLLECTIONS.leadTasks),
          or(
            and(where("organizationId", "==", organizationId), where("assigneeId", "==", uid)),
            and(where("organizationId", "==", organizationId), where("createdById", "==", uid)),
          ),
        )
      : query(collection(db, COLLECTIONS.leadTasks), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qLeadTasks,
        (snap) => {
          const leadTasks = snap.docs.map((d) =>
            asLeadTask(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("leadTasks", "leadTasks", leadTasks);
        },
        (err) => applyListenerError("leadTasks", err),
      ),
    );

    const qTouchpoints = memberScope
      ? query(
          collection(db, COLLECTIONS.touchpoints),
          where("organizationId", "==", organizationId),
          where("leadOwnerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.touchpoints), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qTouchpoints,
        (snap) => {
          const touchpoints = snap.docs.map((d) =>
            asTouchpoint(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("touchpoints", "touchpoints", touchpoints);
        },
        (err) => applyListenerError("touchpoints", err),
      ),
    );

    const qTimeline = memberScope
      ? query(
          collection(db, COLLECTIONS.timelineEvents),
          where("organizationId", "==", organizationId),
          where("leadOwnerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.timelineEvents), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qTimeline,
        (snap) => {
          const timelineEvents = snap.docs.map((d) =>
            asTimelineEvent(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("timelineEvents", "timelineEvents", timelineEvents);
        },
        (err) => applyListenerError("timelineEvents", err),
      ),
    );

    const qActivityCounters = memberScope
      ? query(
          collection(db, COLLECTIONS.activityCounters),
          where("organizationId", "==", organizationId),
          where("userId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.activityCounters), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qActivityCounters,
        (snap) => {
          const activityCounters = snap.docs.map((d) =>
            asActivityCounterRow(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("activityCounters", "activityCounters", activityCounters);
        },
        (err) => applyListenerError("activityCounters", err),
      ),
    );

    const qActivityRecords = memberScope
      ? query(
          collection(db, COLLECTIONS.activityRecords),
          where("organizationId", "==", organizationId),
          where("userId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.activityRecords), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qActivityRecords,
        (snap) => {
          const activityRecords = snap.docs.map((d) =>
            asActivityRecord(d.id, d.data() as Record<string, unknown>),
          );
          applySnapshot("activityRecords", "activityRecords", activityRecords);
        },
        (err) => applyListenerError("activityRecords", err),
      ),
    );

    const qProfiles = memberScope
      ? query(
          collection(db, COLLECTIONS.profiles),
          where("organizationId", "==", organizationId),
          where("ownerId", "==", uid),
        )
      : query(collection(db, COLLECTIONS.profiles), where("organizationId", "==", organizationId));
    unsubs.push(
      onSnapshot(
        qProfiles,
        (snap) => {
          const profiles = snap.docs.map((d) => asProfile(d.id, d.data() as Record<string, unknown>));
          applySnapshot("profiles", "profiles", profiles);
        },
        (err) => applyListenerError("profiles", err),
      ),
    );

    const qCampaigns = query(
      collection(db, COLLECTIONS.campaigns),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qCampaigns,
        (snap) => {
          const campaigns = snap.docs.map((d) => asCampaign(d.id, d.data() as Record<string, unknown>));
          applySnapshot("campaigns", "campaigns", campaigns);
        },
        (err) => applyListenerError("campaigns", err),
      ),
    );

    const qLabels = query(
      collection(db, COLLECTIONS.labels),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qLabels,
        (snap) => {
          const crmLabels = snap.docs.map((d) => asCrmLabel(d.id, d.data() as Record<string, unknown>));
          applySnapshot("crmLabels", "crmLabels", crmLabels);
        },
        (err) => applyListenerError("crmLabels", err),
      ),
    );

    return () => {
      listenerErrorsRef.current.clear();
      for (const u of unsubs) u();
    };
  }, [organizationId, viewerUid, narrowToMemberCrm]);

  return state;
}
