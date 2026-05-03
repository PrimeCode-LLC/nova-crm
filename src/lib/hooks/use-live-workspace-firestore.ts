"use client";

import * as React from "react";
import {
  collection,
  onSnapshot,
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
  Contact,
  Deal,
  Followup,
  Lead,
  Note,
  Role,
  Touchpoint,
  TimelineEvent,
  User,
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
  touchpoints: Touchpoint[];
  timelineEvents: TimelineEvent[];
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
  touchpoints: [],
  timelineEvents: [],
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

/**
 * Real-time tenant CRM documents for live workspace mode.
 */
export function useLiveWorkspaceFirestore(organizationId: string | undefined): LiveWorkspaceFirestoreState {
  const [state, setState] = React.useState<LiveWorkspaceFirestoreState>(empty);

  React.useEffect(() => {
    if (!organizationId || !isFirebaseWebConfigured()) {
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
        touchpoints: [],
        timelineEvents: [],
      });
      return;
    }

    let db: ReturnType<typeof getFirebaseDb>;
    try {
      db = getFirebaseDb();
    } catch (e) {
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
        touchpoints: [],
        timelineEvents: [],
      });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

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
          setState((prev) => ({ ...prev, users, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qLeads = query(
      collection(db, COLLECTIONS.leads),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qLeads,
        (snap) => {
          const leads = snap.docs.map((d) => asLead(d.id, d.data() as Record<string, unknown>));
          setState((prev) => ({ ...prev, leads, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qAccounts = query(
      collection(db, COLLECTIONS.accounts),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qAccounts,
        (snap) => {
          const accounts = snap.docs.map((d) =>
            asAccount(d.id, d.data() as Record<string, unknown>),
          );
          setState((prev) => ({ ...prev, accounts, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qContacts = query(
      collection(db, COLLECTIONS.contacts),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qContacts,
        (snap) => {
          const contacts = snap.docs.map((d) =>
            asContact(d.id, d.data() as Record<string, unknown>),
          );
          setState((prev) => ({ ...prev, contacts, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qDeals = query(
      collection(db, COLLECTIONS.deals),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qDeals,
        (snap) => {
          const deals = snap.docs.map((d) => asDeal(d.id, d.data() as Record<string, unknown>));
          setState((prev) => ({ ...prev, deals, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qNotes = query(
      collection(db, COLLECTIONS.notes),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qNotes,
        (snap) => {
          const notes = snap.docs.map((d) => asNote(d.id, d.data() as Record<string, unknown>));
          setState((prev) => ({ ...prev, notes, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qFollowups = query(
      collection(db, COLLECTIONS.followups),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qFollowups,
        (snap) => {
          const followups = snap.docs.map((d) =>
            asFollowup(d.id, d.data() as Record<string, unknown>),
          );
          setState((prev) => ({ ...prev, followups, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qTouchpoints = query(
      collection(db, COLLECTIONS.touchpoints),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qTouchpoints,
        (snap) => {
          const touchpoints = snap.docs.map((d) =>
            asTouchpoint(d.id, d.data() as Record<string, unknown>),
          );
          setState((prev) => ({ ...prev, touchpoints, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    const qTimeline = query(
      collection(db, COLLECTIONS.timelineEvents),
      where("organizationId", "==", organizationId),
    );
    unsubs.push(
      onSnapshot(
        qTimeline,
        (snap) => {
          const timelineEvents = snap.docs.map((d) =>
            asTimelineEvent(d.id, d.data() as Record<string, unknown>),
          );
          setState((prev) => ({ ...prev, timelineEvents, loading: false }));
        },
        (err) => setState((prev) => ({ ...prev, error: err, loading: false })),
      ),
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, [organizationId]);

  return state;
}
