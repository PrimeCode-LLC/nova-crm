"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceMode } from "@/lib/workspace-mode";
import type {
  Account,
  Campaign,
  Contact,
  Department,
  Followup,
  Lead,
  Note,
  PermissionOverride,
  PipelineStage,
  Profile,
  Touchpoint,
  TimelineEvent,
  User,
} from "@/lib/types";
import {
  getWorkspaceSnapshot,
  createWorkspaceLookup,
  type WorkspaceSnapshot,
  type WorkspaceLookup,
} from "@/lib/workspace-dataset";
import { setWorkspaceModeCookie } from "@/app/(app)/actions/workspace-mode";
import { setDemoPersonaCookie } from "@/app/(app)/actions/demo-persona";
import {
  emptyWorkspaceSession,
  mergeSessionIntoSnapshot,
  readWorkspaceSession,
  writeWorkspaceSession,
  type WorkspaceSessionV2,
} from "@/lib/workspace-session";
import { STAGES_BY_KEY } from "@/lib/constants";

export type WorkspaceContextValue = WorkspaceSnapshot &
  WorkspaceLookup & {
    mode: WorkspaceMode;
    isDemo: boolean;
    demoPersonaId: string;
    setMode: (next: WorkspaceMode) => Promise<void>;
    setDemoPersona: (userId: string) => Promise<void>;
    addPermissionOverride: (override: PermissionOverride) => void;
    removePermissionOverride: (id: string) => void;
    addDepartment: (dept: Department) => void;
    updateProfile: (id: string, patch: Partial<Profile>) => void;
    addProfile: (profile: Profile) => void;
    updateCampaign: (id: string, patch: Partial<Campaign>) => void;
    addCampaign: (campaign: Campaign) => void;
    addAccount: (account: Account) => void;
    addContact: (contact: Contact) => void;
    addLead: (lead: Lead) => void;
    patchUser: (userId: string, patch: Partial<Omit<User, "id">>) => void;
    /** Session-backed (persists in tab until refresh / mode change). */
    sessionHydrated: boolean;
    addFollowup: (f: Followup) => void;
    setFollowupCompleted: (id: string, completed: boolean) => void;
    addLeadNote: (leadId: string, body: string, authorId: string) => void;
    updateLeadNote: (noteId: string, patch: Partial<Pick<Note, "body" | "pinned">>) => void;
    deleteLeadNote: (noteId: string) => void;
    addLeadTouchpoint: (t: Touchpoint) => void;
    addTimelineEvent: (e: TimelineEvent) => void;
    patchLead: (leadId: string, patch: Partial<Lead>) => void;
    updateLeadStage: (leadId: string, nextStage: PipelineStage, previousStage: PipelineStage, actorId: string) => void;
    toggleLeadPin: (leadId: string) => void;
    isLeadPinned: (leadId: string) => boolean;
    bumpLeadActivity: (leadId: string) => void;
  };

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

function newLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

export function WorkspaceModeProvider({
  initialMode,
  initialDemoPersonaId,
  children,
}: {
  initialMode: WorkspaceMode;
  initialDemoPersonaId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mode, setModeState] = React.useState<WorkspaceMode>(initialMode);
  const [demoPersonaId, setDemoPersonaState] = React.useState(initialDemoPersonaId);

  React.useEffect(() => {
    setModeState(initialMode);
  }, [initialMode]);

  React.useEffect(() => {
    setDemoPersonaState(initialDemoPersonaId);
  }, [initialDemoPersonaId]);

  const setMode = React.useCallback(
    async (next: WorkspaceMode) => {
      setModeState(next);
      await setWorkspaceModeCookie(next);
      router.refresh();
    },
    [router],
  );

  const setDemoPersona = React.useCallback(
    async (userId: string) => {
      setDemoPersonaState(userId);
      await setDemoPersonaCookie(userId);
      router.refresh();
    },
    [router],
  );

  const baseSnapshot = React.useMemo(
    () => getWorkspaceSnapshot(mode, demoPersonaId),
    [mode, demoPersonaId],
  );

  const [poDelta, setPoDelta] = React.useState<{
    added: PermissionOverride[];
    removedIds: string[];
  }>({ added: [], removedIds: [] });

  const [addedDepartments, setAddedDepartments] = React.useState<Department[]>([]);

  const [profileDelta, setProfileDelta] = React.useState<{
    updates: Record<string, Partial<Profile>>;
    added: Profile[];
  }>({ updates: {}, added: [] });

  const [campaignEdits, setCampaignEdits] = React.useState<Record<string, Partial<Campaign>>>({});
  const [campaignsAdded, setCampaignsAdded] = React.useState<Campaign[]>([]);

  const [accountsAdded, setAccountsAdded] = React.useState<Account[]>([]);
  const [contactsAdded, setContactsAdded] = React.useState<Contact[]>([]);
  const [leadsAdded, setLeadsAdded] = React.useState<Lead[]>([]);
  const [userPatches, setUserPatches] = React.useState<Record<string, Partial<Omit<User, "id">>>>({});
  const [accountContactBumps, setAccountContactBumps] = React.useState<Record<string, number>>({});

  const [sessionV2, setSessionV2] = React.useState<WorkspaceSessionV2>(() => emptyWorkspaceSession());
  const [sessionHydrated, setSessionHydrated] = React.useState(false);

  React.useEffect(() => {
    React.startTransition(() => {
      setSessionV2(readWorkspaceSession());
      setSessionHydrated(true);
    });
  }, []);

  React.useEffect(() => {
    if (!sessionHydrated || typeof window === "undefined") return;
    writeWorkspaceSession(sessionV2);
  }, [sessionV2, sessionHydrated]);

  React.useEffect(() => {
    if (mode !== "demo") {
      setSessionV2(emptyWorkspaceSession());
    }
  }, [mode]);

  React.useEffect(() => {
    setPoDelta({ added: [], removedIds: [] });
    setAddedDepartments([]);
    setProfileDelta({ updates: {}, added: [] });
    setCampaignEdits({});
    setCampaignsAdded([]);
    setAccountsAdded([]);
    setContactsAdded([]);
    setLeadsAdded([]);
    setUserPatches({});
    setAccountContactBumps({});
  }, [mode, demoPersonaId]);

  const addPermissionOverride = React.useCallback((override: PermissionOverride) => {
    setPoDelta((d) => ({ ...d, added: [...d.added, override] }));
  }, []);

  const removePermissionOverride = React.useCallback((id: string) => {
    setPoDelta((d) => {
      const added = d.added.filter((x) => x.id !== id);
      if (added.length !== d.added.length) {
        return { ...d, added };
      }
      if (d.removedIds.includes(id)) return d;
      return { ...d, removedIds: [...d.removedIds, id] };
    });
  }, []);

  const addDepartment = React.useCallback((dept: Department) => {
    setAddedDepartments((prev) => [...prev, dept]);
  }, []);

  const updateProfile = React.useCallback((id: string, patch: Partial<Profile>) => {
    setProfileDelta((d) => ({
      ...d,
      updates: { ...d.updates, [id]: { ...d.updates[id], ...patch } },
    }));
  }, []);

  const addProfile = React.useCallback((profile: Profile) => {
    setProfileDelta((d) => ({ ...d, added: [...d.added, profile] }));
  }, []);

  const updateCampaign = React.useCallback((id: string, patch: Partial<Campaign>) => {
    setCampaignEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const addCampaign = React.useCallback((campaign: Campaign) => {
    setCampaignsAdded((prev) => [...prev, campaign]);
  }, []);

  const addAccount = React.useCallback((account: Account) => {
    setAccountsAdded((prev) => [...prev, account]);
  }, []);

  const addContact = React.useCallback((contact: Contact) => {
    setContactsAdded((prev) => [...prev, contact]);
    setAccountContactBumps((b) => ({
      ...b,
      [contact.accountId]: (b[contact.accountId] ?? 0) + 1,
    }));
  }, []);

  const addLead = React.useCallback((lead: Lead) => {
    setLeadsAdded((prev) => [...prev, lead]);
  }, []);

  const patchUser = React.useCallback((userId: string, patch: Partial<Omit<User, "id">>) => {
    setUserPatches((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));
  }, []);

  const bumpLeadActivity = React.useCallback((leadId: string) => {
    const iso = new Date().toISOString();
    setSessionV2((s) => ({
      ...s,
      leadActivity: {
        ...s.leadActivity,
        [leadId]: {
          bump: (s.leadActivity[leadId]?.bump ?? 0) + 1,
          lastAt: iso,
        },
      },
    }));
  }, []);

  const addFollowup = React.useCallback((f: Followup) => {
    const iso = new Date().toISOString();
    setSessionV2((s) => {
      const next: WorkspaceSessionV2 = {
        ...s,
        followups: { ...s.followups, extras: [...s.followups.extras, f] },
      };
      if (!f.leadId) return next;
      return {
        ...next,
        leadActivity: {
          ...next.leadActivity,
          [f.leadId]: {
            bump: (next.leadActivity[f.leadId]?.bump ?? 0) + 1,
            lastAt: iso,
          },
        },
      };
    });
  }, []);

  const setFollowupCompleted = React.useCallback((id: string, completed: boolean) => {
    setSessionV2((s) => {
      const completion = { ...s.followups.completion };
      if (completed) completion[id] = new Date().toISOString();
      else completion[id] = null;
      return { ...s, followups: { ...s.followups, completion } };
    });
  }, []);

  const addLeadNote = React.useCallback(
    (leadId: string, body: string, authorId: string) => {
      const iso = new Date().toISOString();
      const id = newLocalId("n-local");
      const note: Note = {
        id,
        leadId,
        authorId,
        body: body.trim(),
        createdAt: iso,
        pinned: false,
      };
      const timeline: TimelineEvent = {
        id: newLocalId("te-local"),
        leadId,
        type: "note_added",
        actorId: authorId,
        summary: `Added note: "${body.trim().slice(0, 80)}${body.trim().length > 80 ? "…" : ""}"`,
        createdAt: iso,
      };
      setSessionV2((s) => ({
        ...s,
        notes: { ...s.notes, added: [...s.notes.added, note] },
        timelineAdded: [...s.timelineAdded, timeline],
        leadActivity: {
          ...s.leadActivity,
          [leadId]: {
            bump: (s.leadActivity[leadId]?.bump ?? 0) + 1,
            lastAt: iso,
          },
        },
      }));
    },
    [],
  );

  const updateLeadNote = React.useCallback((noteId: string, patch: Partial<Pick<Note, "body" | "pinned">>) => {
    setSessionV2((s) => {
      const inAdded = s.notes.added.findIndex((n) => n.id === noteId);
      if (inAdded >= 0) {
        const nextAdded = s.notes.added.map((n, i) => (i === inAdded ? { ...n, ...patch } : n));
        return { ...s, notes: { ...s.notes, added: nextAdded } };
      }
      return {
        ...s,
        notes: {
          ...s.notes,
          updates: { ...s.notes.updates, [noteId]: { ...s.notes.updates[noteId], ...patch } },
        },
      };
    });
  }, []);

  const deleteLeadNote = React.useCallback((noteId: string) => {
    setSessionV2((s) => {
      const wasAdded = s.notes.added.some((n) => n.id === noteId);
      if (wasAdded) {
        return {
          ...s,
          notes: { ...s.notes, added: s.notes.added.filter((n) => n.id !== noteId) },
        };
      }
      if (s.notes.removedIds.includes(noteId)) return s;
      return { ...s, notes: { ...s.notes, removedIds: [...s.notes.removedIds, noteId] } };
    });
  }, []);

  const addLeadTouchpoint = React.useCallback((t: Touchpoint) => {
    const iso = t.occurredAt || new Date().toISOString();
    const event: TimelineEvent = {
      id: newLocalId("te-local"),
      leadId: t.leadId,
      type: "touchpoint_added",
      actorId: t.actorId,
      summary: t.summary ? `Touchpoint: ${t.summary}` : `Touchpoint logged (${t.state})`,
      createdAt: iso,
    };
    setSessionV2((s) => ({
      ...s,
      touchpointsAdded: [...s.touchpointsAdded, { ...t, occurredAt: iso }],
      timelineAdded: [...s.timelineAdded, event],
      leadActivity: {
        ...s.leadActivity,
        [t.leadId]: {
          bump: (s.leadActivity[t.leadId]?.bump ?? 0) + 1,
          lastAt: iso,
        },
      },
    }));
  }, []);

  const addTimelineEvent = React.useCallback((e: TimelineEvent) => {
    setSessionV2((s) => ({
      ...s,
      timelineAdded: [...s.timelineAdded, e],
      leadActivity: {
        ...s.leadActivity,
        [e.leadId]: {
          bump: (s.leadActivity[e.leadId]?.bump ?? 0) + 1,
          lastAt: e.createdAt,
        },
      },
    }));
  }, []);

  const patchLead = React.useCallback((leadId: string, patch: Partial<Lead>) => {
    const iso = new Date().toISOString();
    setSessionV2((s) => ({
      ...s,
      leadPatches: { ...s.leadPatches, [leadId]: { ...s.leadPatches[leadId], ...patch, updatedAt: iso } },
    }));
  }, []);

  const updateLeadStage = React.useCallback(
    (leadId: string, nextStage: PipelineStage, previousStage: PipelineStage, actorId: string) => {
      const iso = new Date().toISOString();
      const ev: TimelineEvent = {
        id: newLocalId("te-local"),
        leadId,
        type: "stage_changed",
        actorId,
        summary: `Moved from ${STAGES_BY_KEY[previousStage].label} → ${STAGES_BY_KEY[nextStage].label}`,
        createdAt: iso,
      };
      setSessionV2((s) => ({
        ...s,
        leadPatches: {
          ...s.leadPatches,
          [leadId]: { ...s.leadPatches[leadId], stage: nextStage, updatedAt: iso },
        },
        timelineAdded: [...s.timelineAdded, ev],
      }));
    },
    [],
  );

  const toggleLeadPin = React.useCallback((leadId: string) => {
    setSessionV2((s) => {
      const has = s.pinnedLeadIds.includes(leadId);
      return {
        ...s,
        pinnedLeadIds: has ? s.pinnedLeadIds.filter((id) => id !== leadId) : [...s.pinnedLeadIds, leadId],
      };
    });
  }, []);

  const isLeadPinned = React.useCallback(
    (leadId: string) => {
      return sessionV2.pinnedLeadIds.includes(leadId);
    },
    [sessionV2.pinnedLeadIds],
  );

  const preSessionSnapshot = React.useMemo((): WorkspaceSnapshot => {
    const removed = new Set(poDelta.removedIds);
    const permissionOverrides = [
      ...baseSnapshot.permissionOverrides.filter((p) => !removed.has(p.id)),
      ...poDelta.added,
    ];
    const applyPatches = (list: Profile[]) =>
      list.map((p) => {
        const patch = profileDelta.updates[p.id];
        return patch ? { ...p, ...patch } : p;
      });
    const profiles = [
      ...applyPatches(baseSnapshot.profiles),
      ...applyPatches(profileDelta.added),
    ];
    const campaigns = [
      ...baseSnapshot.campaigns.map((c) =>
        campaignEdits[c.id] ? { ...c, ...campaignEdits[c.id] } : c,
      ),
      ...campaignsAdded.map((c) =>
        campaignEdits[c.id] ? { ...c, ...campaignEdits[c.id] } : c,
      ),
    ];
    const accountsMerged = [...baseSnapshot.accounts, ...accountsAdded].map((a) => ({
      ...a,
      contactCount: a.contactCount + (accountContactBumps[a.id] ?? 0),
    }));
    const contactsMerged = [...baseSnapshot.contacts, ...contactsAdded];
    const leadsMerged = [...baseSnapshot.leads, ...leadsAdded];
    const usersMerged = baseSnapshot.users.map((u) => ({
      ...u,
      ...(userPatches[u.id] ?? {}),
    }));
    return {
      ...baseSnapshot,
      permissionOverrides,
      departments: [...baseSnapshot.departments, ...addedDepartments],
      profiles,
      campaigns,
      accounts: accountsMerged,
      contacts: contactsMerged,
      leads: leadsMerged,
      users: usersMerged,
    };
  }, [
    baseSnapshot,
    poDelta,
    addedDepartments,
    profileDelta,
    campaignEdits,
    campaignsAdded,
    accountsAdded,
    contactsAdded,
    leadsAdded,
    userPatches,
    accountContactBumps,
  ]);

  const snapshot = React.useMemo((): WorkspaceSnapshot => {
    const merged = mergeSessionIntoSnapshot(preSessionSnapshot, sessionV2);
    return { ...preSessionSnapshot, ...merged };
  }, [preSessionSnapshot, sessionV2]);

  const value = React.useMemo<WorkspaceContextValue>(() => {
    const lookup = createWorkspaceLookup(snapshot);
    return {
      ...snapshot,
      ...lookup,
      mode,
      isDemo: mode === "demo",
      demoPersonaId,
      setMode,
      setDemoPersona,
      addPermissionOverride,
      removePermissionOverride,
      addDepartment,
      updateProfile,
      addProfile,
      updateCampaign,
      addCampaign,
      addAccount,
      addContact,
      addLead,
      patchUser,
      sessionHydrated,
      addFollowup,
      setFollowupCompleted,
      addLeadNote,
      updateLeadNote,
      deleteLeadNote,
      addLeadTouchpoint,
      addTimelineEvent,
      patchLead,
      updateLeadStage,
      toggleLeadPin,
      isLeadPinned,
      bumpLeadActivity,
    };
  }, [
    snapshot,
    mode,
    demoPersonaId,
    setMode,
    setDemoPersona,
    addPermissionOverride,
    removePermissionOverride,
    addDepartment,
    updateProfile,
    addProfile,
    updateCampaign,
    addCampaign,
    addAccount,
    addContact,
    addLead,
    patchUser,
    sessionHydrated,
    addFollowup,
    setFollowupCompleted,
    addLeadNote,
    updateLeadNote,
    deleteLeadNote,
    addLeadTouchpoint,
    addTimelineEvent,
    patchLead,
    updateLeadStage,
    toggleLeadPin,
    isLeadPinned,
    bumpLeadActivity,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceModeProvider");
  }
  return ctx;
}
