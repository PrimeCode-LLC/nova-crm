import type {
  Followup,
  FollowupPlan,
  LeadTask,
  Note,
  Touchpoint,
  TimelineEvent,
  Lead,
  Account,
  Contact,
  Deal,
} from "@/lib/types";
import type { WorkspaceSnapshot } from "@/lib/workspace-dataset";
import { mockLeads } from "./mock-data";

/** Unified session mutations (demo + local session until Firestore writes exist). */
export const WORKSPACE_SESSION_KEY = "nova-crm-workspace-session-v2";
const LEGACY_FOLLOWUP_KEY = "nova-crm-followup-delta-v1";

export type FollowupSessionDelta = {
  extras: Followup[];
  completion: Record<string, string | null>;
  /** followupId → pausedAt ISO, or null to clear */
  paused: Record<string, string | null>;
};

export type FollowupPlanSessionDelta = {
  extras: FollowupPlan[];
  patches: Record<string, Partial<FollowupPlan>>;
};

export type LeadTaskSessionDelta = {
  extras: LeadTask[];
  completion: Record<string, string | null>;
};

export type NotesSessionDelta = {
  added: Note[];
  removedIds: string[];
  updates: Record<string, Partial<Pick<Note, "body" | "pinned">>>;
};

export type WorkspaceSessionV2 = {
  followups: FollowupSessionDelta;
  followupPlans: FollowupPlanSessionDelta;
  leadTasks: LeadTaskSessionDelta;
  notes: NotesSessionDelta;
  touchpointsAdded: Touchpoint[];
  timelineAdded: TimelineEvent[];
  leadPatches: Record<string, Partial<Lead>>;
  accountPatches: Record<string, Partial<Account>>;
  contactPatches: Record<string, Partial<Contact>>;
  dealPatches: Record<string, Partial<Deal>>;
  /** Session-removed lead ids (demo / optimistic hide until Firestore listener catches up). */
  deletedLeadIds: string[];
  pinnedLeadIds: string[];
  /** Increment touches + refresh lastActivityAt for session-scoped activity. */
  leadActivity: Record<string, { bump: number; lastAt?: string }>;
};

export function emptyWorkspaceSession(): WorkspaceSessionV2 {
  return {
    followups: { extras: [], completion: {}, paused: {} },
    followupPlans: { extras: [], patches: {} },
    leadTasks: { extras: [], completion: {} },
    notes: { added: [], removedIds: [], updates: {} },
    touchpointsAdded: [],
    timelineAdded: [],
    leadPatches: {},
    accountPatches: {},
    contactPatches: {},
    dealPatches: {},
    deletedLeadIds: [],
    pinnedLeadIds: [],
    leadActivity: {},
  };
}

function mergeFollowup(
  f: Followup,
  completion: Record<string, string | null>,
  paused: Record<string, string | null>,
): Followup {
  let next = f;
  if (Object.prototype.hasOwnProperty.call(completion, f.id)) {
    const c = completion[f.id];
    next = c === null ? { ...next, completedAt: undefined } : { ...next, completedAt: c };
  }
  if (Object.prototype.hasOwnProperty.call(paused, f.id)) {
    const p = paused[f.id];
    next = p === null ? { ...next, pausedAt: undefined } : { ...next, pausedAt: p };
  }
  return next;
}

function mergeFollowupPlan(
  p: FollowupPlan,
  patches: Record<string, Partial<FollowupPlan>>,
): FollowupPlan {
  const patch = patches[p.id];
  return patch ? { ...p, ...patch } : p;
}

function mergeLeadTask(t: LeadTask, completion: Record<string, string | null>): LeadTask {
  if (!Object.prototype.hasOwnProperty.call(completion, t.id)) return t;
  const c = completion[t.id];
  if (c === null) return { ...t, completedAt: undefined };
  return { ...t, completedAt: c };
}

export function readWorkspaceSession(): WorkspaceSessionV2 {
  if (typeof window === "undefined") return emptyWorkspaceSession();
  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkspaceSessionV2>;
      return normalizeSession(parsed);
    }
    const legacy = window.sessionStorage.getItem(LEGACY_FOLLOWUP_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as FollowupSessionDelta;
      const migrated: WorkspaceSessionV2 = {
        ...emptyWorkspaceSession(),
        followups:
          parsed && Array.isArray(parsed.extras) && typeof parsed.completion === "object"
            ? {
                extras: parsed.extras,
                completion: parsed.completion,
                paused: {},
              }
            : { extras: [], completion: {}, paused: {} },
        followupPlans: { extras: [], patches: {} },
        leadTasks: { extras: [], completion: {} },
      };
      window.sessionStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return emptyWorkspaceSession();
}

function normalizeSession(parsed: Partial<WorkspaceSessionV2>): WorkspaceSessionV2 {
  const empty = emptyWorkspaceSession();
  const followupsRaw = parsed.followups;
  return {
    followups: {
      extras: Array.isArray(followupsRaw?.extras) ? followupsRaw!.extras : [],
      completion:
        followupsRaw?.completion && typeof followupsRaw.completion === "object"
          ? followupsRaw.completion
          : {},
      paused:
        followupsRaw?.paused && typeof followupsRaw.paused === "object" ? followupsRaw.paused : {},
    },
    followupPlans: {
      extras: Array.isArray(parsed.followupPlans?.extras) ? parsed.followupPlans!.extras : [],
      patches:
        parsed.followupPlans?.patches && typeof parsed.followupPlans.patches === "object"
          ? parsed.followupPlans.patches
          : {},
    },
    leadTasks: {
      extras: Array.isArray(parsed.leadTasks?.extras) ? parsed.leadTasks!.extras : [],
      completion:
        parsed.leadTasks?.completion && typeof parsed.leadTasks!.completion === "object"
          ? parsed.leadTasks!.completion
          : {},
    },
    notes: {
      added: Array.isArray(parsed.notes?.added) ? parsed.notes!.added : [],
      removedIds: Array.isArray(parsed.notes?.removedIds) ? parsed.notes!.removedIds : [],
      updates: parsed.notes?.updates && typeof parsed.notes.updates === "object" ? parsed.notes.updates : {},
    },
    touchpointsAdded: Array.isArray(parsed.touchpointsAdded) ? parsed.touchpointsAdded : [],
    timelineAdded: Array.isArray(parsed.timelineAdded) ? parsed.timelineAdded : [],
    leadPatches: parsed.leadPatches && typeof parsed.leadPatches === "object" ? parsed.leadPatches : {},
    accountPatches:
      parsed.accountPatches && typeof parsed.accountPatches === "object" ? parsed.accountPatches : {},
    contactPatches:
      parsed.contactPatches && typeof parsed.contactPatches === "object" ? parsed.contactPatches : {},
    dealPatches: parsed.dealPatches && typeof parsed.dealPatches === "object" ? parsed.dealPatches : {},
    deletedLeadIds: Array.isArray(parsed.deletedLeadIds) ? parsed.deletedLeadIds : [],
    pinnedLeadIds: Array.isArray(parsed.pinnedLeadIds) ? parsed.pinnedLeadIds : [],
    leadActivity: parsed.leadActivity && typeof parsed.leadActivity === "object" ? parsed.leadActivity : {},
  };
}

export function writeWorkspaceSession(session: WorkspaceSessionV2): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* quota */
  }
}

const MOCK_LEAD_IDS = new Set(mockLeads.map((l) => l.id));

/**
 * Strips session keys that reference ids outside the static demo lead catalog.
 * Prevents stale tab/sessionStorage (e.g. deleted Firestore ids) from hiding all mock leads in Demo mode.
 */
export function sanitizeWorkspaceSessionForMockCatalog(session: WorkspaceSessionV2): WorkspaceSessionV2 {
  const deletedLeadIds = session.deletedLeadIds.filter((id) => MOCK_LEAD_IDS.has(id));
  const leadPatches = Object.fromEntries(
    Object.entries(session.leadPatches).filter(([id]) => MOCK_LEAD_IDS.has(id)),
  );
  const leadActivity = Object.fromEntries(
    Object.entries(session.leadActivity).filter(([id]) => MOCK_LEAD_IDS.has(id)),
  );
  const pinnedLeadIds = session.pinnedLeadIds.filter((id) => MOCK_LEAD_IDS.has(id));
  return {
    ...session,
    deletedLeadIds,
    leadPatches,
    leadActivity,
    pinnedLeadIds,
  };
}

function leadVisible(id: string | undefined, visible: Set<string>): boolean {
  if (!id) return false;
  return visible.has(id);
}

/** Merges session-layer edits into an already persona-scoped workspace snapshot. */
export function mergeSessionIntoSnapshot(
  base: WorkspaceSnapshot,
  session: WorkspaceSessionV2,
): Pick<
  WorkspaceSnapshot,
  | "followups"
  | "followupPlans"
  | "leadTasks"
  | "notes"
  | "touchpoints"
  | "timelineByLead"
  | "leads"
  | "accounts"
  | "contacts"
  | "deals"
> {
  const deletedLeadIds = new Set(session.deletedLeadIds ?? []);

  const leads = base.leads
    .filter((l) => !deletedLeadIds.has(l.id))
    .map((l) => {
      const patch = session.leadPatches[l.id] ?? {};
      const act = session.leadActivity[l.id];
      const touches = act ? l.touches + act.bump : l.touches;
      const lastActivityAt = act?.lastAt ?? l.lastActivityAt;
      return { ...l, ...patch, touches, lastActivityAt };
    });

  const accounts = base.accounts.map((a) => {
    const p = session.accountPatches[a.id];
    return p ? { ...a, ...p } : a;
  });

  const contacts = base.contacts.map((c) => {
    const p = session.contactPatches[c.id];
    return p ? { ...c, ...p } : c;
  });

  const visibleLeadIds = new Set(leads.map((l) => l.id));
  const visibleDealIds = new Set(
    base.deals.filter((d) => visibleLeadIds.has(d.leadId)).map((d) => d.id),
  );

  const removedNotes = new Set(session.notes.removedIds);
  const mergedBaseNotes = base.notes
    .filter((n) => !removedNotes.has(n.id))
    .map((n) => {
      const u = session.notes.updates[n.id];
      return u ? { ...n, ...u } : n;
    })
    .filter((n) => !n.leadId || visibleLeadIds.has(n.leadId));
  const baseNoteIds = new Set(mergedBaseNotes.map((n) => n.id));
  const notes = [
    ...mergedBaseNotes,
    ...session.notes.added.filter(
      (n) => leadVisible(n.leadId, visibleLeadIds) && !baseNoteIds.has(n.id),
    ),
  ];

  const baseTouchpointIds = new Set(base.touchpoints.map((t) => t.id));
  const touchpoints = [
    ...base.touchpoints.filter((t) => visibleLeadIds.has(t.leadId)),
    ...session.touchpointsAdded.filter(
      (t) => visibleLeadIds.has(t.leadId) && !baseTouchpointIds.has(t.id),
    ),
  ];

  const timelineByLead: Record<string, TimelineEvent[]> = {};
  for (const [leadId, events] of Object.entries(base.timelineByLead)) {
    if (!visibleLeadIds.has(leadId)) continue;
    timelineByLead[leadId] = [...events];
  }
  for (const e of session.timelineAdded) {
    if (!visibleLeadIds.has(e.leadId)) continue;
    const list = timelineByLead[e.leadId] ? [...timelineByLead[e.leadId]] : [];
    if (list.some((x) => x.id === e.id)) continue;
    list.push(e);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    timelineByLead[e.leadId] = list;
  }

  const mergedBaseFollowups = base.followups
    .filter((f) => !f.leadId || visibleLeadIds.has(f.leadId))
    .map((f) => mergeFollowup(f, session.followups.completion, session.followups.paused));
  const baseFollowupIds = new Set(mergedBaseFollowups.map((f) => f.id));
  const mergedExtras = session.followups.extras
    .filter(
      (f) =>
        !baseFollowupIds.has(f.id) &&
        ((f.leadId == null && f.dealId == null) ||
          (f.leadId != null && visibleLeadIds.has(f.leadId)) ||
          (f.dealId != null && visibleDealIds.has(f.dealId))),
    )
    .map((f) => mergeFollowup(f, session.followups.completion, session.followups.paused));
  const followups = [...mergedBaseFollowups, ...mergedExtras];

  const mergedBasePlans = (base.followupPlans ?? [])
    .filter((p) => visibleLeadIds.has(p.leadId))
    .map((p) => mergeFollowupPlan(p, session.followupPlans.patches));
  const basePlanIds = new Set(mergedBasePlans.map((p) => p.id));
  const planExtras = session.followupPlans.extras
    .filter((p) => visibleLeadIds.has(p.leadId) && !basePlanIds.has(p.id))
    .map((p) => mergeFollowupPlan(p, session.followupPlans.patches));
  const followupPlans = [...mergedBasePlans, ...planExtras];

  const mergedBaseLeadTasks = base.leadTasks
    .filter((t) => !t.leadId || visibleLeadIds.has(t.leadId))
    .map((t) => mergeLeadTask(t, session.leadTasks.completion));
  const baseLeadTaskIds = new Set(mergedBaseLeadTasks.map((t) => t.id));
  const leadTaskExtrasFiltered = session.leadTasks.extras
    .filter((t) => !baseLeadTaskIds.has(t.id))
    .map((t) => mergeLeadTask(t, session.leadTasks.completion));
  const leadTasks = [...mergedBaseLeadTasks, ...leadTaskExtrasFiltered];

  const deals = base.deals
    .filter((d) => visibleLeadIds.has(d.leadId))
    .map((d) => {
      const p = session.dealPatches[d.id];
      return p ? { ...d, ...p } : d;
    });

  return {
    followups,
    followupPlans,
    leadTasks,
    notes,
    touchpoints,
    timelineByLead,
    leads,
    accounts,
    contacts,
    deals,
  };
}
