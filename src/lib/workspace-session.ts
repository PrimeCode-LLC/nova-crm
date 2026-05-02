import type { Followup, Note, Touchpoint, TimelineEvent, Lead } from "@/lib/types";
import type { WorkspaceSnapshot } from "@/lib/workspace-dataset";

/** Unified session mutations (demo + local session until Firestore writes exist). */
export const WORKSPACE_SESSION_KEY = "nova-crm-workspace-session-v2";
const LEGACY_FOLLOWUP_KEY = "nova-crm-followup-delta-v1";

export type FollowupSessionDelta = {
  extras: Followup[];
  completion: Record<string, string | null>;
};

export type NotesSessionDelta = {
  added: Note[];
  removedIds: string[];
  updates: Record<string, Partial<Pick<Note, "body" | "pinned">>>;
};

export type WorkspaceSessionV2 = {
  followups: FollowupSessionDelta;
  notes: NotesSessionDelta;
  touchpointsAdded: Touchpoint[];
  timelineAdded: TimelineEvent[];
  leadPatches: Record<string, Partial<Lead>>;
  pinnedLeadIds: string[];
  /** Increment touches + refresh lastActivityAt for session-scoped activity. */
  leadActivity: Record<string, { bump: number; lastAt?: string }>;
};

export function emptyWorkspaceSession(): WorkspaceSessionV2 {
  return {
    followups: { extras: [], completion: {} },
    notes: { added: [], removedIds: [], updates: {} },
    touchpointsAdded: [],
    timelineAdded: [],
    leadPatches: {},
    pinnedLeadIds: [],
    leadActivity: {},
  };
}

function mergeFollowup(f: Followup, completion: Record<string, string | null>): Followup {
  if (!Object.prototype.hasOwnProperty.call(completion, f.id)) return f;
  const c = completion[f.id];
  if (c === null) return { ...f, completedAt: undefined };
  return { ...f, completedAt: c };
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
            ? { extras: parsed.extras, completion: parsed.completion }
            : { extras: [], completion: {} },
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
  return {
    followups: {
      extras: Array.isArray(parsed.followups?.extras) ? parsed.followups!.extras : [],
      completion:
        parsed.followups?.completion && typeof parsed.followups.completion === "object"
          ? parsed.followups.completion
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
  "followups" | "notes" | "touchpoints" | "timelineByLead" | "leads"
> {
  const visibleLeadIds = new Set(base.leads.map((l) => l.id));
  const visibleDealIds = new Set(base.deals.map((d) => d.id));

  const removedNotes = new Set(session.notes.removedIds);
  const notes = [
    ...base.notes
      .filter((n) => !removedNotes.has(n.id))
      .map((n) => {
        const u = session.notes.updates[n.id];
        return u ? { ...n, ...u } : n;
      }),
    ...session.notes.added.filter((n) => leadVisible(n.leadId, visibleLeadIds)),
  ];

  const touchpoints = [
    ...base.touchpoints,
    ...session.touchpointsAdded.filter((t) => visibleLeadIds.has(t.leadId)),
  ];

  const timelineByLead: Record<string, TimelineEvent[]> = { ...base.timelineByLead };
  for (const e of session.timelineAdded) {
    if (!visibleLeadIds.has(e.leadId)) continue;
    const list = timelineByLead[e.leadId] ? [...timelineByLead[e.leadId]] : [];
    list.push(e);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    timelineByLead[e.leadId] = list;
  }

  const mergedBaseFollowups = base.followups.map((f) => mergeFollowup(f, session.followups.completion));
  const mergedExtras = session.followups.extras
    .filter(
      (f) =>
        (f.leadId != null && visibleLeadIds.has(f.leadId)) ||
        (f.dealId != null && visibleDealIds.has(f.dealId)),
    )
    .map((f) => mergeFollowup(f, session.followups.completion));
  const followups = [...mergedBaseFollowups, ...mergedExtras];

  const leads = base.leads.map((l) => {
    const patch = session.leadPatches[l.id] ?? {};
    const act = session.leadActivity[l.id];
    const touches = act ? l.touches + act.bump : l.touches;
    const lastActivityAt = act?.lastAt ?? l.lastActivityAt;
    return { ...l, ...patch, touches, lastActivityAt };
  });

  return { followups, notes, touchpoints, timelineByLead, leads };
}
