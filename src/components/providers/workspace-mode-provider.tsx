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
  FollowupPlan,
  Lead,
  LeadTask,
  Note,
  OrganizationMember,
  PermissionOverride,
  PipelineStage,
  Profile,
  Touchpoint,
  TimelineEvent,
  User,
  CrmLabel,
  Deal,
  OrgMemberRole,
} from "@/lib/types";
import {
  createWorkspaceLookup,
  LIVE_SNAPSHOT,
  type WorkspaceSnapshot,
  type WorkspaceLookup,
} from "@/lib/workspace-dataset";
import {
  applyLiveHierarchyScope,
  collectDescendantUserIds,
  seesAllLeadsInTenant,
} from "@/lib/workspace-hierarchy";
import { useAuth } from "@/components/providers/auth-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { useLiveWorkspaceFirestore } from "@/lib/hooks/use-live-workspace-firestore";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { getFirebaseDb } from "@/lib/firebase/client";
import { resolveOrganizationIdForFirestoreWrite } from "@/lib/firebase/resolve-organization-id-for-write";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { groupTimelineEventsByLead } from "@/lib/firestore/group-timeline-events";
import {
  persistAccountCreateClient,
  persistContactCreateClient,
  persistLeadCreateClient,
} from "@/lib/firestore/persist-lead-graph-client";
import { persistLeadPatchClient } from "@/lib/firestore/persist-lead-patch-client";
import { persistAccountPatchClient } from "@/lib/firestore/persist-account-patch-client";
import { persistContactPatchClient } from "@/lib/firestore/persist-contact-patch-client";
import { persistDealPatchClient } from "@/lib/firestore/persist-deal-patch-client";
import {
  persistCrmLabelCreate,
  persistCrmLabelDelete,
  persistCrmLabelUpdate,
} from "@/lib/firestore/persist-crm-label-client";
import { persistLeadDeleteClient } from "@/lib/firestore/persist-lead-delete-client";
import {
  persistFollowupCreate,
  persistFollowupDelete,
  persistFollowupEmailSchedule,
  persistFollowupSetCompleted,
  persistFollowupSetPaused,
  persistFollowupPlanCreate,
  persistFollowupPlanPatch,
  persistLeadTaskCreate,
  persistLeadTaskSetCompleted,
  persistLeadActivityBump,
  persistNoteCreate,
  persistNoteDelete,
  persistNoteUpdate,
  persistProfileCreate,
  persistProfileUpdate,
  persistCampaignCreate,
  persistCampaignUpdate,
  persistTimelineEventCreate,
  persistTouchpointCreate,
} from "@/lib/firestore/persist-workspace-entities-client";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { isAuthDisabled } from "@/lib/auth/flags";
import { setWorkspaceModeCookie } from "@/app/(app)/actions/workspace-mode";
import { setDemoPersonaCookie } from "@/app/(app)/actions/demo-persona";
import {
  emptyWorkspaceSession,
  mergeSessionIntoSnapshot,
  readWorkspaceSession,
  sanitizeWorkspaceSessionForMockCatalog,
  writeWorkspaceSession,
  type WorkspaceSessionV2,
} from "@/lib/workspace-session";
import { STAGES_BY_KEY } from "@/lib/constants";
import {
  recordDealStageChangeClient,
  recordLeadCreatedClient,
  recordLeadStageChangeClient,
} from "@/lib/firestore/audit-change-client";
import { leadDisplayLabel } from "@/lib/leads/lead-display-label";
import { enrichLeadsIdleState } from "@/lib/lead-idle";
import { mergeFollowupPlans } from "@/lib/followup-plans";
import { roleAtLeast } from "@/lib/platform/org-role";
import {
  canEditProspectDerivedLead,
  isProspectRow,
  prospectPatchForSalesLeadSync,
} from "@/lib/prospects/prospect-access";

export type WorkspaceContextValue = WorkspaceSnapshot &
  WorkspaceLookup & {
    mode: WorkspaceMode;
    isDemo: boolean;
    demoPersonaId: string;
    /** Live mode: tenant id from the signed-in user doc (for writes / diagnostics). */
    organizationId?: string;
    /** Display name for the signed-in tenant (from Firestore org). */
    organizationName: string;
    /** Live mode: Firestore workspace listeners hit an error (partial data may be stale). */
    liveFirestoreError: Error | null;
    /** Live mode: listener for the signed-in user document failed. */
    userProfileError: Error | null;
    /** True while workspace data is still loading (live Firestore or demo bundle). */
    workspaceLoading: boolean;
    setMode: (next: WorkspaceMode) => Promise<void>;
    setDemoPersona: (userId: string) => Promise<void>;
    addPermissionOverride: (override: PermissionOverride) => void;
    removePermissionOverride: (id: string) => void;
    addDepartment: (dept: Department) => void;
    updateProfile: (id: string, patch: Partial<Profile>) => void;
    addProfile: (profile: Profile) => void;
    updateCampaign: (id: string, patch: Partial<Campaign>) => void;
    addCampaign: (campaign: Campaign) => void;
    addAccount: (account: Account) => Promise<void>;
    addContact: (contact: Contact) => Promise<void>;
    addLead: (lead: Lead) => Promise<void>;
    /** Merge server-created CRM rows into the client cache without writing again (e.g. intake promote). */
    stageCrmEntities: (payload: {
      leads?: Lead[];
      accounts?: Account[];
      contacts?: Contact[];
    }) => void;
    patchUser: (userId: string, patch: Partial<Omit<User, "id">>) => void;
    /** Session-backed (persists in tab until refresh / mode change). */
    sessionHydrated: boolean;
    addFollowup: (f: Followup) => void;
    createFollowupPlanWithFollowups: (plan: FollowupPlan, followups: Followup[]) => void;
    setFollowupCompleted: (id: string, completed: boolean) => void;
    setFollowupEmailSchedule: (
      id: string,
      schedule: { scheduledEmailId: string; emailScheduledAt: string } | null,
    ) => void;
    clearFollowupEmailSchedule: (id: string) => void;
    removeFollowup: (id: string) => void;
    pauseFollowupPlanForReply: (input: {
      planId: string;
      leadId: string;
      reason: string;
      replyMessageId?: string;
      actorId: string;
      openFollowupIds: string[];
    }) => void;
    supersedeFollowupPlan: (oldPlanId: string, newPlanId: string) => void;
    addLeadTask: (t: LeadTask) => void;
    setLeadTaskCompleted: (id: string, completed: boolean) => void;
    addLeadNote: (leadId: string, body: string, authorId: string) => void;
    updateLeadNote: (noteId: string, patch: Partial<Pick<Note, "body" | "pinned">>) => void;
    deleteLeadNote: (noteId: string) => void;
    addLeadTouchpoint: (t: Touchpoint) => void;
    addTimelineEvent: (e: TimelineEvent) => void;
    patchLead: (leadId: string, patch: Partial<Lead>) => void;
    /** Like `patchLead` but awaits the Firestore write (live mode). Throws on permission or network errors. */
    patchLeadAsync: (leadId: string, patch: Partial<Lead>) => Promise<void>;
    patchAccount: (accountId: string, patch: Partial<Account>) => void;
    patchContact: (contactId: string, patch: Partial<Contact>) => void;
    /** Removes a lead (org owner or admin only in live). Resolves `true` if removed or queued successfully. */
    deleteLead: (leadId: string, options?: { quiet?: boolean }) => Promise<boolean>;
    /** Whether the active user may delete leads (org `owner` or `admin`). */
    canDeleteLeads: boolean;
    /** Whether the active user may edit this lead (prospect-derived leads are admin-only). */
    canEditLead: (lead: Lead) => boolean;
    /** Org role for the signed-in user (defaults to member when missing on the user row). */
    viewerOrgRole: OrgMemberRole;
    /** May open another member's linked inbox: admins, managers with reports, or explicit delegation. */
    canViewMemberMailboxes: boolean;
    /** User ids whose mailboxes the viewer may open (empty when `canViewMemberMailboxes` is false). */
    mailboxViewableUserIds: string[];
    updateLeadStage: (leadId: string, nextStage: PipelineStage, previousStage: PipelineStage, actorId: string) => void;
    toggleLeadPin: (leadId: string) => void;
    isLeadPinned: (leadId: string) => boolean;
    bumpLeadActivity: (leadId: string) => void;
    /** Display name for CRM `ownerId` when the user exists in org members but not (yet) in Firestore `users`. */
    getOwnerDisplayName: (uid: string) => string | undefined;
    addCrmLabel: (label: CrmLabel) => void;
    updateCrmLabel: (id: string, patch: Partial<Pick<CrmLabel, "name" | "color">>) => void;
    removeCrmLabel: (id: string) => void;
    patchDeal: (dealId: string, patch: Partial<Deal>) => void;
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
  organizationName: organizationNameProp,
  children,
}: {
  initialMode: WorkspaceMode;
  initialDemoPersonaId: string;
  /** Resolved on the server from the session’s organizationId; fallback label if missing. */
  organizationName?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mode, setModeState] = React.useState<WorkspaceMode>(initialMode);
  const [demoPersonaId, setDemoPersonaState] = React.useState(initialDemoPersonaId);
  const [demoSnapshot, setDemoSnapshot] = React.useState<WorkspaceSnapshot | null>(null);
  const snapshotRef = React.useRef<WorkspaceSnapshot>(LIVE_SNAPSHOT);

  const organizationName =
    organizationNameProp?.trim() || "Workspace";

  React.useEffect(() => {
    setModeState(initialMode);
  }, [initialMode]);

  React.useEffect(() => {
    setDemoPersonaState(initialDemoPersonaId);
  }, [initialDemoPersonaId]);

  React.useEffect(() => {
    if (mode !== "demo") {
      setDemoSnapshot(null);
      return;
    }
    let cancelled = false;
    void import("@/lib/workspace-dataset-demo").then(({ getWorkspaceSnapshotDemo }) => {
      if (!cancelled) {
        setDemoSnapshot(getWorkspaceSnapshotDemo(demoPersonaId));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, demoPersonaId]);

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

  const [labelDelta, setLabelDelta] = React.useState<{
    added: CrmLabel[];
    removedIds: string[];
    updates: Record<string, Partial<Pick<CrmLabel, "name" | "color">>>;
  }>({ added: [], removedIds: [], updates: {} });

  const [sessionV2, setSessionV2] = React.useState<WorkspaceSessionV2>(() => emptyWorkspaceSession());
  const [sessionHydrated, setSessionHydrated] = React.useState(false);

  const { user: fbUser } = useAuth();
  const { data: userDoc, error: userProfileLoadError } = useUserDoc(
    mode === "demo" || isAuthDisabled() || !fbUser ? undefined : fbUser.uid,
  );
  const liveOrgId =
    mode === "live" && userDoc?.organizationId ? userDoc.organizationId : undefined;
  const viewerForMemberScope = React.useMemo((): User | null => {
    if (!userDoc || !fbUser?.uid) return null;
    return { ...userDoc, id: fbUser.uid } as User;
  }, [fbUser?.uid, userDoc]);
  /** Align Firestore queries with rules: narrow unless viewer sees the full tenant (directors / owner / admin / manager org roles). */
  const narrowMemberCrm = viewerForMemberScope
    ? !seesAllLeadsInTenant(viewerForMemberScope)
    : userDoc?.orgRole === "member";
  const liveFs = useLiveWorkspaceFirestore(
    liveOrgId,
    fbUser?.uid,
    narrowMemberCrm,
    viewerForMemberScope,
  );

  const liveLeadsForPersistRef = React.useRef<Lead[]>([]);
  React.useEffect(() => {
    liveLeadsForPersistRef.current = liveFs.leads;
  }, [liveFs.leads]);

  const leadOwnerIdForFirestore = React.useCallback((leadId: string) => {
    return liveLeadsForPersistRef.current.find((l) => l.id === leadId)?.ownerId?.trim() ?? "";
  }, []);

  const [orgMemberLabels, setOrgMemberLabels] = React.useState<Record<string, string>>({});
  const [delegatedMailboxHostIds, setDelegatedMailboxHostIds] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!liveOrgId) {
      setOrgMemberLabels({});
      return;
    }
    let cancelled = false;
    void fetch("/api/org/members", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { members?: OrganizationMember[] };
        const members = data.members ?? [];
        const next: Record<string, string> = {};
        for (const m of members) {
          const label =
            m.displayName?.trim() ||
            (m.email.includes("@") ? m.email.split("@")[0] : m.email) ||
            m.uid;
          next[m.uid] = label;
        }
        if (!cancelled) setOrgMemberLabels(next);
      })
      .catch(() => {
        if (!cancelled) setOrgMemberLabels({});
      });
    return () => {
      cancelled = true;
    };
  }, [liveOrgId]);

  React.useEffect(() => {
    if (mode !== "live" || !liveOrgId || !sessionHydrated) {
      setDelegatedMailboxHostIds([]);
      return;
    }
    let cancelled = false;
    void fetch("/api/email/delegations?mode=accessible_hosts", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { hostIds?: string[] };
        if (!cancelled) setDelegatedMailboxHostIds(data.hostIds ?? []);
      })
      .catch(() => {
        if (!cancelled) setDelegatedMailboxHostIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, liveOrgId, sessionHydrated]);

  React.useEffect(() => {
    React.startTransition(() => {
      const raw = readWorkspaceSession();
      setSessionV2(
        initialMode === "demo" ? sanitizeWorkspaceSessionForMockCatalog(raw) : raw,
      );
      setSessionHydrated(true);
    });
  }, [initialMode]);

  React.useEffect(() => {
    if (!sessionHydrated || typeof window === "undefined") return;
    writeWorkspaceSession(sessionV2);
  }, [sessionV2, sessionHydrated]);

  /** Only drop session-layer deltas when leaving demo; clearing on every live mount wiped `leadPatches` after sessionStorage hydrate. */
  const prevModeRef = React.useRef<WorkspaceMode | null>(null);
  React.useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev === "demo" && mode === "live") {
      setSessionV2(emptyWorkspaceSession());
    } else if (prev === "live" && mode === "demo") {
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
    setLabelDelta({ added: [], removedIds: [], updates: {} });
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

  const updateProfile = React.useCallback(
    (id: string, patch: Partial<Profile>) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistProfileUpdate(db, id, patch);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save profile", { description: msg });
          }
        })();
        return;
      }
      setProfileDelta((d) => ({
        ...d,
        updates: { ...d.updates, [id]: { ...d.updates[id], ...patch } },
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const addProfile = React.useCallback(
    (profile: Profile) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistProfileCreate(db, orgId, profile);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save profile", { description: msg });
          }
        })();
        return;
      }
      setProfileDelta((d) => ({ ...d, added: [...d.added, profile] }));
    },
    [mode, userDoc?.organizationId],
  );

  const updateCampaign = React.useCallback(
    (id: string, patch: Partial<Campaign>) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistCampaignUpdate(db, id, patch);
          } catch (e) {
            console.error(e);
            toast.error("Could not save campaign");
          }
        })();
        return;
      }
      setCampaignEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    },
    [mode, userDoc?.organizationId],
  );

  const addCampaign = React.useCallback(
    (campaign: Campaign) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            const orgId = userDoc!.organizationId!;
            await persistCampaignCreate(db, orgId, campaign);
          } catch (e) {
            console.error(e);
            toast.error("Could not create campaign");
          }
        })();
        return;
      }
      setCampaignsAdded((prev) => [...prev, campaign]);
    },
    [mode, userDoc?.organizationId],
  );

  const addAccount = React.useCallback(
    async (account: Account): Promise<void> => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        try {
          const db = getFirebaseDb();
          await persistAccountCreateClient(db, orgId, account);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("Could not save company", { description: msg });
          throw e;
        }
      }
      setAccountsAdded((prev) => [...prev, account]);
    },
    [mode, userDoc?.organizationId],
  );

  const addContact = React.useCallback(
    async (contact: Contact): Promise<void> => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        try {
          const db = getFirebaseDb();
          await persistContactCreateClient(db, orgId, contact);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("Could not save contact", { description: msg });
          throw e;
        }
      }
      setContactsAdded((prev) => [...prev, contact]);
      setAccountContactBumps((b) => ({
        ...b,
        [contact.accountId]: (b[contact.accountId] ?? 0) + 1,
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const addLead = React.useCallback(
    async (lead: Lead): Promise<void> => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        try {
          const db = getFirebaseDb();
          await persistLeadCreateClient(db, orgId, lead);
          recordLeadCreatedClient({
            leadId: lead.id,
            leadName: leadDisplayLabel(lead),
            channel: lead.channel,
            isProspect: isProspectRow(lead),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("Could not save lead", { description: msg });
          throw e;
        }
      }
      setLeadsAdded((prev) => [...prev, lead]);
    },
    [mode, userDoc?.organizationId],
  );

  const stageCrmEntities = React.useCallback(
    (payload: { leads?: Lead[]; accounts?: Account[]; contacts?: Contact[] }) => {
      if (payload.accounts?.length) {
        setAccountsAdded((prev) => {
          const ids = new Set(prev.map((a) => a.id));
          return [...prev, ...payload.accounts!.filter((a) => !ids.has(a.id))];
        });
      }
      if (payload.contacts?.length) {
        setContactsAdded((prev) => {
          const ids = new Set(prev.map((c) => c.id));
          return [...prev, ...payload.contacts!.filter((c) => !ids.has(c.id))];
        });
      }
      if (payload.leads?.length) {
        setLeadsAdded((prev) => {
          const ids = new Set(prev.map((l) => l.id));
          return [...prev, ...payload.leads!.filter((l) => !ids.has(l.id))];
        });
      }
    },
    [],
  );

  const patchUser = React.useCallback((userId: string, patch: Partial<Omit<User, "id">>) => {
    setUserPatches((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));
  }, []);

  const bumpLeadActivity = React.useCallback(
    (leadId: string) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistLeadActivityBump(db, leadId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not update activity", { description: msg });
          }
        })();
        return;
      }
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
    },
    [mode, userDoc?.organizationId],
  );

  const addFollowup = React.useCallback(
    (f: Followup) => {
      const iso = new Date().toISOString();
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistFollowupCreate(db, orgId, f);
            if (f.leadId) await persistLeadActivityBump(db, f.leadId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save follow-up", { description: msg });
          }
        })();
      }
      setSessionV2((s) => {
        const next: WorkspaceSessionV2 = {
          ...s,
          followups: { ...s.followups, extras: [...s.followups.extras, f] },
        };
        if (!f.leadId) return next;
        if (writeFs) return next;
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
    },
    [mode, userDoc?.organizationId],
  );

  const createFollowupPlanWithFollowups = React.useCallback(
    (plan: FollowupPlan, items: Followup[]) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistFollowupPlanCreate(db, orgId, plan);
            for (const f of items) {
              await persistFollowupCreate(db, orgId, f);
            }
            if (plan.leadId) await persistLeadActivityBump(db, plan.leadId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save follow-up plan", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        followupPlans: {
          ...s.followupPlans,
          extras: [...s.followupPlans.extras, plan],
        },
        followups: {
          ...s.followups,
          extras: [...s.followups.extras, ...items],
        },
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const pauseFollowupPlanForReply = React.useCallback(
    (input: {
      planId: string;
      leadId: string;
      reason: string;
      replyMessageId?: string;
      actorId: string;
      openFollowupIds: string[];
    }) => {
      const iso = new Date().toISOString();
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      const planPatch: Partial<FollowupPlan> = {
        status: "paused",
        pausedAt: iso,
        pausedReason: input.reason,
        replyMessageId: input.replyMessageId,
      };
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistFollowupPlanPatch(db, input.planId, planPatch);
            for (const fid of input.openFollowupIds) {
              await persistFollowupSetPaused(db, fid, true);
            }
            const te: TimelineEvent = {
              id: newLocalId("te"),
              leadId: input.leadId,
              type: "followup_plan_paused",
              actorId: input.actorId,
              summary: `Follow-up plan paused: ${input.reason}`,
              payload: { planId: input.planId, replyMessageId: input.replyMessageId },
              createdAt: iso,
            };
            await persistTimelineEventCreate(db, orgId, te, leadOwnerIdForFirestore(input.leadId));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not pause follow-up plan", { description: msg });
          }
        })();
      }
      setSessionV2((s) => {
        const paused = { ...s.followups.paused };
        for (const fid of input.openFollowupIds) {
          paused[fid] = iso;
        }
        const patches = {
          ...s.followupPlans.patches,
          [input.planId]: {
            ...(s.followupPlans.patches[input.planId] ?? {}),
            ...planPatch,
          },
        };
        const extras = s.followupPlans.extras.map((p) =>
          p.id === input.planId ? { ...p, ...planPatch } : p,
        );
        const te: TimelineEvent = {
          id: newLocalId("te"),
          leadId: input.leadId,
          type: "followup_plan_paused",
          actorId: input.actorId,
          summary: `Follow-up plan paused: ${input.reason}`,
          payload: { planId: input.planId, replyMessageId: input.replyMessageId },
          createdAt: iso,
        };
        return {
          ...s,
          followupPlans: { ...s.followupPlans, patches, extras },
          followups: { ...s.followups, paused },
          timelineAdded: [...s.timelineAdded, te],
        };
      });
      toast.message("Lead replied, follow-up plan paused", {
        description: "Review the inbox and regenerate next steps when ready.",
        duration: 8000,
      });
    },
    [mode, userDoc?.organizationId, leadOwnerIdForFirestore],
  );

  const supersedeFollowupPlan = React.useCallback(
    (oldPlanId: string, newPlanId: string) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistFollowupPlanPatch(db, oldPlanId, {
              status: "superseded",
              supersededByPlanId: newPlanId,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not update prior plan", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        followupPlans: {
          ...s.followupPlans,
          patches: {
            ...s.followupPlans.patches,
            [oldPlanId]: {
              ...(s.followupPlans.patches[oldPlanId] ?? {}),
              status: "superseded",
              supersededByPlanId: newPlanId,
            },
          },
        },
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const setFollowupCompleted = React.useCallback(
    (id: string, completed: boolean) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistFollowupSetCompleted(db, id, completed);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not update follow-up", { description: msg });
          }
        })();
      }
      setSessionV2((s) => {
        const completion = { ...s.followups.completion };
        if (completed) completion[id] = new Date().toISOString();
        else completion[id] = null;
        return { ...s, followups: { ...s.followups, completion } };
      });
    },
    [mode, userDoc?.organizationId],
  );

  const setFollowupEmailSchedule = React.useCallback(
    (
      id: string,
      schedule: { scheduledEmailId: string; emailScheduledAt: string } | null,
    ) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistFollowupEmailSchedule(db, id, schedule);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not update email schedule", { description: msg });
          }
        })();
      }
      // Live mode relies on Firestore listeners; session overlay would re-apply after cron clears.
      if (mode !== "live") {
        setSessionV2((s) => ({
          ...s,
          followups: {
            ...s.followups,
            emailSchedule: {
              ...s.followups.emailSchedule,
              [id]: schedule,
            },
          },
        }));
      }
    },
    [mode, userDoc?.organizationId],
  );

  const clearFollowupEmailSchedule = React.useCallback(
    (id: string) => {
      setFollowupEmailSchedule(id, null);
    },
    [setFollowupEmailSchedule],
  );

  const removeFollowup = React.useCallback(
    (id: string) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistFollowupDelete(db, id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not delete follow-up", { description: msg });
          }
        })();
      }
      setSessionV2((s) => {
        const completion = { ...s.followups.completion };
        delete completion[id];
        return {
          ...s,
          followups: {
            ...s.followups,
            extras: s.followups.extras.filter((f) => f.id !== id),
            completion,
          },
        };
      });
    },
    [mode, userDoc?.organizationId],
  );

  const addLeadTask = React.useCallback(
    (t: LeadTask) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistLeadTaskCreate(db, orgId, t);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save task", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        leadTasks: { ...s.leadTasks, extras: [...s.leadTasks.extras, t] },
      }));
    },
    [mode, userDoc?.organizationId],
  );

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
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistNoteCreate(db, orgId, note, {
              leadOwnerId: leadOwnerIdForFirestore(leadId),
            });
            await persistTimelineEventCreate(db, orgId, timeline, leadOwnerIdForFirestore(leadId));
            await persistLeadActivityBump(db, leadId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save note", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        notes: { ...s.notes, added: [...s.notes.added, note] },
        timelineAdded: [...s.timelineAdded, timeline],
        leadActivity: writeFs
          ? s.leadActivity
          : {
              ...s.leadActivity,
              [leadId]: {
                bump: (s.leadActivity[leadId]?.bump ?? 0) + 1,
                lastAt: iso,
              },
            },
      }));
    },
    [mode, userDoc?.organizationId, leadOwnerIdForFirestore],
  );

  const updateLeadNote = React.useCallback(
    (noteId: string, patch: Partial<Pick<Note, "body" | "pinned">>) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistNoteUpdate(db, noteId, patch);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save note", { description: msg });
          }
        })();
      }
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
    },
    [mode, userDoc?.organizationId],
  );

  const deleteLeadNote = React.useCallback(
    (noteId: string) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistNoteDelete(db, noteId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not delete note", { description: msg });
          }
        })();
      }
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
    },
    [mode, userDoc?.organizationId],
  );

  const addLeadTouchpoint = React.useCallback(
    (t: Touchpoint) => {
      const iso = t.occurredAt || new Date().toISOString();
      const event: TimelineEvent = {
        id: newLocalId("te-local"),
        leadId: t.leadId,
        type: "touchpoint_added",
        actorId: t.actorId,
        summary: t.summary ? `Touchpoint: ${t.summary}` : `Touchpoint logged (${t.state})`,
        createdAt: iso,
      };
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistTouchpointCreate(db, orgId, { ...t, occurredAt: iso }, leadOwnerIdForFirestore(t.leadId));
            await persistTimelineEventCreate(db, orgId, event, leadOwnerIdForFirestore(t.leadId));
            await persistLeadActivityBump(db, t.leadId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save touchpoint", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        touchpointsAdded: [...s.touchpointsAdded, { ...t, occurredAt: iso }],
        timelineAdded: [...s.timelineAdded, event],
        leadActivity: writeFs
          ? s.leadActivity
          : {
              ...s.leadActivity,
              [t.leadId]: {
                bump: (s.leadActivity[t.leadId]?.bump ?? 0) + 1,
                lastAt: iso,
              },
            },
      }));
    },
    [mode, userDoc?.organizationId, leadOwnerIdForFirestore],
  );

  const addTimelineEvent = React.useCallback(
    (e: TimelineEvent) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistTimelineEventCreate(db, orgId, e, leadOwnerIdForFirestore(e.leadId));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error("Could not save timeline event", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        timelineAdded: [...s.timelineAdded, e],
        leadActivity: writeFs
          ? s.leadActivity
          : {
              ...s.leadActivity,
              [e.leadId]: {
                bump: (s.leadActivity[e.leadId]?.bump ?? 0) + 1,
                lastAt: e.createdAt,
              },
            },
      }));
    },
    [mode, userDoc?.organizationId, leadOwnerIdForFirestore],
  );

  const applyLeadPatchToSession = React.useCallback(
    (leadId: string, patch: Partial<Lead>, iso: string) => {
      setSessionV2((s) => ({
        ...s,
        leadPatches: { ...s.leadPatches, [leadId]: { ...s.leadPatches[leadId], ...patch, updatedAt: iso } },
      }));
    },
    [],
  );

  const patchLeadAsync = React.useCallback(
    async (leadId: string, patch: Partial<Lead>) => {
      const viewerRole: OrgMemberRole =
        snapshotRef.current.users.find((u) => u.id === snapshotRef.current.currentUserId)?.orgRole ??
        userDoc?.orgRole ??
        "member";
      const lead = snapshotRef.current.leads.find((l) => l.id === leadId);
      if (lead && !canEditProspectDerivedLead(lead, viewerRole)) {
        throw new Error("Only workspace admins can edit this lead.");
      }
      const iso = new Date().toISOString();
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        const db = getFirebaseDb();
        await persistLeadPatchClient(db, leadId, patch);
      }
      applyLeadPatchToSession(leadId, patch, iso);

      const linkedSalesLeadId = lead?.linkedSalesLeadId?.trim();
      if (lead && isProspectRow(lead) && linkedSalesLeadId) {
        const salesPatch = prospectPatchForSalesLeadSync(patch);
        if (Object.keys(salesPatch).length > 0) {
          if (writeFs) {
            const db = getFirebaseDb();
            await persistLeadPatchClient(db, linkedSalesLeadId, salesPatch);
          }
          applyLeadPatchToSession(linkedSalesLeadId, salesPatch, iso);
        }
      }
    },
    [mode, userDoc?.organizationId, userDoc?.orgRole, applyLeadPatchToSession],
  );

  const patchLead = React.useCallback(
    (leadId: string, patch: Partial<Lead>) => {
      void patchLeadAsync(leadId, patch).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Only workspace admins")) {
          toast.error(msg);
        } else {
          toast.error("Could not save lead", { description: msg });
        }
      });
    },
    [patchLeadAsync],
  );

  const patchAccount = React.useCallback(
    (accountId: string, patch: Partial<Account>) => {
      const iso = new Date().toISOString();
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistAccountPatchClient(db, accountId, { ...patch, updatedAt: iso });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save company", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        accountPatches: {
          ...s.accountPatches,
          [accountId]: { ...s.accountPatches[accountId], ...patch, updatedAt: iso },
        },
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const patchContact = React.useCallback(
    (contactId: string, patch: Partial<Contact>) => {
      const iso = new Date().toISOString();
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistContactPatchClient(db, contactId, { ...patch, updatedAt: iso });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save contact", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        contactPatches: {
          ...s.contactPatches,
          [contactId]: { ...s.contactPatches[contactId], ...patch, updatedAt: iso },
        },
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const patchDeal = React.useCallback(
    (dealId: string, patch: Partial<Deal>) => {
      const iso = new Date().toISOString();
      const snap = snapshotRef.current;
      const existing = snap.deals.find((d) => d.id === dealId);
      const merged = existing ? { ...existing, ...patch } : null;
      const linkedLead = merged?.leadId
        ? snap.leads.find((l) => l.id === merged.leadId)
        : undefined;
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistDealPatchClient(db, dealId, { ...patch, updatedAt: iso });
            if (existing && patch.stage && patch.stage !== existing.stage) {
              recordDealStageChangeClient({
                dealId,
                dealName: merged?.name,
                prevStage: existing.stage,
                nextStage: patch.stage,
                channel: linkedLead?.channel,
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save deal", { description: msg });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        dealPatches: {
          ...s.dealPatches,
          [dealId]: { ...s.dealPatches[dealId], ...patch, updatedAt: iso },
        },
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const addCrmLabel = React.useCallback(
    (label: CrmLabel) => {
      const canLiveWrite = mode === "live" && isFirebaseWebConfigured() && Boolean(fbUser);
      if (canLiveWrite) {
        void (async () => {
          try {
            const orgId = await resolveOrganizationIdForFirestoreWrite(userDoc?.organizationId);
            if (!orgId) {
              toast.error("Could not save label", {
                description:
                  "No organization id on your session. Try refreshing the page or signing out and back in.",
              });
              return;
            }
            const db = getFirebaseDb();
            await persistCrmLabelCreate(db, orgId, label);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save label", { description: msg });
          }
        })();
        return;
      }
      setLabelDelta((d) => ({ ...d, added: [...d.added, label] }));
    },
    [mode, fbUser, userDoc?.organizationId],
  );

  const updateCrmLabel = React.useCallback(
    (id: string, patch: Partial<Pick<CrmLabel, "name" | "color">>) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistCrmLabelUpdate(db, id, patch);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not update label", { description: msg });
          }
        })();
        return;
      }
      setLabelDelta((d) => ({
        ...d,
        updates: { ...d.updates, [id]: { ...d.updates[id], ...patch } },
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const removeCrmLabel = React.useCallback(
    (id: string) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistCrmLabelDelete(db, id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not delete label", { description: msg });
          }
        })();
        return;
      }
      setLabelDelta((d) => ({
        ...d,
        added: d.added.filter((l) => l.id !== id),
        removedIds: d.removedIds.includes(id) ? d.removedIds : [...d.removedIds, id],
        updates: Object.fromEntries(Object.entries(d.updates).filter(([k]) => k !== id)),
      }));
    },
    [mode, userDoc?.organizationId],
  );

  const deleteLead = React.useCallback(
    async (leadId: string, options?: { quiet?: boolean }): Promise<boolean> => {
      const quiet = options?.quiet === true;
      const snap = snapshotRef.current;
      const role = snap.users.find((u) => u.id === snap.currentUserId)?.orgRole;
      const allowed = role === "owner" || role === "admin";
      if (!allowed) {
        if (!quiet) {
          toast.error("Only organization owners and admins can delete leads.");
        }
        return false;
      }
      const lead = snap.leads.find((l) => l.id === leadId);
      if (!lead) return false;
      const account = snap.accounts.find((a) => a.id === lead.accountId);
      if (!account) {
        if (!quiet) {
          toast.error("Could not delete lead: account not found.");
        }
        return false;
      }

      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      if (writeFs) {
        try {
          const db = getFirebaseDb();
          await persistLeadDeleteClient(db, {
            leadId,
            accountId: account.id,
            accountLeadCount: account.leadCount,
          });
          if (!quiet) toast.success("Lead deleted");
          setLeadsAdded((prev) => prev.filter((l) => l.id !== leadId));
          setSessionV2((s) => {
            if (s.deletedLeadIds.includes(leadId)) return s;
            const leadPatches = { ...s.leadPatches };
            delete leadPatches[leadId];
            const leadActivity = { ...s.leadActivity };
            delete leadActivity[leadId];
            return {
              ...s,
              deletedLeadIds: [...s.deletedLeadIds, leadId],
              leadPatches,
              leadActivity,
              pinnedLeadIds: s.pinnedLeadIds.filter((id) => id !== leadId),
            };
          });
          return true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!quiet) toast.error("Could not delete lead", { description: msg });
          return false;
        }
      }

      if (!quiet) toast.success("Lead removed");
      setLeadsAdded((prev) => prev.filter((l) => l.id !== leadId));
      setSessionV2((s) => {
        if (s.deletedLeadIds.includes(leadId)) return s;
        const leadPatches = { ...s.leadPatches };
        delete leadPatches[leadId];
        const leadActivity = { ...s.leadActivity };
        delete leadActivity[leadId];
        return {
          ...s,
          deletedLeadIds: [...s.deletedLeadIds, leadId],
          leadPatches,
          leadActivity,
          pinnedLeadIds: s.pinnedLeadIds.filter((id) => id !== leadId),
        };
      });
      return true;
    },
    [mode, userDoc?.organizationId],
  );

  const updateLeadStage = React.useCallback(
    (leadId: string, nextStage: PipelineStage, previousStage: PipelineStage, actorId: string) => {
      const snap = snapshotRef.current;
      const viewerRole: OrgMemberRole =
        snap.users.find((u) => u.id === snap.currentUserId)?.orgRole ?? userDoc?.orgRole ?? "member";
      const lead = snap.leads.find((l) => l.id === leadId);
      if (lead && !canEditProspectDerivedLead(lead, viewerRole)) {
        toast.error("Only workspace admins can edit this lead.");
        return;
      }

      const iso = new Date().toISOString();
      const ev: TimelineEvent = {
        id: newLocalId("te-local"),
        leadId,
        type: "stage_changed",
        actorId,
        summary: `Moved from ${STAGES_BY_KEY[previousStage].label} → ${STAGES_BY_KEY[nextStage].label}`,
        createdAt: iso,
      };
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      const linkedSalesLeadId = lead?.linkedSalesLeadId?.trim();
      const syncSalesLeadStage = Boolean(lead && isProspectRow(lead) && linkedSalesLeadId);

      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await updateDoc(doc(db, COLLECTIONS.leads, leadId), {
              stage: nextStage,
            });
            await persistTimelineEventCreate(db, orgId, ev, leadOwnerIdForFirestore(leadId));
            if (syncSalesLeadStage && linkedSalesLeadId) {
              await updateDoc(doc(db, COLLECTIONS.leads, linkedSalesLeadId), {
                stage: nextStage,
              });
            }
            recordLeadStageChangeClient({
              leadId,
              leadName: lead ? leadDisplayLabel(lead) : undefined,
              prevStage: previousStage,
              nextStage,
              isProspect: lead ? isProspectRow(lead) : false,
              channel: lead?.channel,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not save stage", { description: msg });
          }
        })();
      }
      setSessionV2((s) => {
        const leadPatches = {
          ...s.leadPatches,
          [leadId]: { ...s.leadPatches[leadId], stage: nextStage },
        };
        if (syncSalesLeadStage && linkedSalesLeadId) {
          leadPatches[linkedSalesLeadId] = {
            ...s.leadPatches[linkedSalesLeadId],
            stage: nextStage,
          };
        }
        return {
          ...s,
          leadPatches,
          timelineAdded: [...s.timelineAdded, ev],
        };
      });
    },
    [mode, userDoc?.organizationId, userDoc?.orgRole, leadOwnerIdForFirestore],
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

  const tenantBaseSnapshot = React.useMemo((): WorkspaceSnapshot => {
    if (mode === "demo") {
      return demoSnapshot ?? LIVE_SNAPSHOT;
    }
    const uid = fbUser?.uid ?? "";
    /** Firestore query uses `organizationId`; if the member doc is missing that field, the roster is empty but leads still store `ownerId` as Firebase uid — merge the viewer so UserChip and owner pickers resolve. */
    let usersForSnapshot = liveFs.users;
    if (uid && userDoc && !usersForSnapshot.some((u) => u.id === uid)) {
      usersForSnapshot = [...usersForSnapshot, { ...userDoc, id: uid }];
    }
    const raw: WorkspaceSnapshot = {
      ...LIVE_SNAPSHOT,
      users: usersForSnapshot,
      leads: liveFs.leads,
      accounts: liveFs.accounts,
      contacts: liveFs.contacts,
      deals: liveFs.deals,
      notes: liveFs.notes,
      followups: liveFs.followups,
      followupPlans: liveFs.followupPlans,
      leadTasks: liveFs.leadTasks,
      touchpoints: liveFs.touchpoints,
      timelineByLead: groupTimelineEventsByLead(liveFs.timelineEvents),
      activityCounters: liveFs.activityCounters,
      activityRecords: liveFs.activityRecords,
      profiles: liveFs.profiles,
      campaigns: liveFs.campaigns,
      crmLabels: liveFs.crmLabels,
      currentUserId: uid,
    };
    if (!uid || !userDoc) {
      return { ...raw, users: liveFs.users };
    }
    const viewer: User = { ...userDoc, id: uid };
    const roster =
      liveFs.users.length === 0
        ? [viewer]
        : liveFs.users.some((u) => u.id === uid)
          ? liveFs.users
          : [...liveFs.users, viewer];
    return applyLiveHierarchyScope(raw, viewer, roster);
  }, [
    mode,
    demoSnapshot,
    demoPersonaId,
    fbUser?.uid,
    userDoc,
    liveFs.users,
    liveFs.leads,
    liveFs.accounts,
    liveFs.contacts,
    liveFs.deals,
    liveFs.notes,
    liveFs.followups,
    liveFs.followupPlans,
    liveFs.leadTasks,
    liveFs.touchpoints,
    liveFs.timelineEvents,
    liveFs.activityCounters,
    liveFs.activityRecords,
    liveFs.profiles,
    liveFs.campaigns,
    liveFs.crmLabels,
  ]);

  const preSessionSnapshot = React.useMemo((): WorkspaceSnapshot => {
    const removed = new Set(poDelta.removedIds);
    const permissionOverrides = [
      ...tenantBaseSnapshot.permissionOverrides.filter((p) => !removed.has(p.id)),
      ...poDelta.added,
    ];
    const applyPatches = (list: Profile[]) =>
      list.map((p) => {
        const patch = profileDelta.updates[p.id];
        return patch ? { ...p, ...patch } : p;
      });
    const profiles = [
      ...applyPatches(tenantBaseSnapshot.profiles),
      ...applyPatches(profileDelta.added),
    ];
    const campaigns = [
      ...tenantBaseSnapshot.campaigns.map((c) =>
        campaignEdits[c.id] ? { ...c, ...campaignEdits[c.id] } : c,
      ),
      ...campaignsAdded.map((c) =>
        campaignEdits[c.id] ? { ...c, ...campaignEdits[c.id] } : c,
      ),
    ];
    const accountIds = new Set(tenantBaseSnapshot.accounts.map((a) => a.id));
    const contactIds = new Set(tenantBaseSnapshot.contacts.map((c) => c.id));
    const leadIds = new Set(tenantBaseSnapshot.leads.map((l) => l.id));
    const accountsMerged = [
      ...tenantBaseSnapshot.accounts,
      ...accountsAdded.filter((a) => !accountIds.has(a.id)),
    ].map((a) => ({
      ...a,
      contactCount: a.contactCount + (accountContactBumps[a.id] ?? 0),
    }));
    const contactsMerged = [
      ...tenantBaseSnapshot.contacts,
      ...contactsAdded.filter((c) => !contactIds.has(c.id)),
    ];
    const leadsMerged = [
      ...tenantBaseSnapshot.leads,
      ...leadsAdded.filter((l) => !leadIds.has(l.id)),
    ];
    const usersMerged = tenantBaseSnapshot.users.map((u) => ({
      ...u,
      ...(userPatches[u.id] ?? {}),
    }));

    const removedLabelIds = new Set(labelDelta.removedIds);
    const mergedLabelBase = tenantBaseSnapshot.crmLabels
      .filter((l) => !removedLabelIds.has(l.id))
      .map((l) => ({ ...l, ...(labelDelta.updates[l.id] ?? {}) }));
    const labelBaseIds = new Set(mergedLabelBase.map((l) => l.id));
    const crmLabels = [
      ...mergedLabelBase,
      ...labelDelta.added
        .filter((l) => !removedLabelIds.has(l.id))
        .map((l) => ({ ...l, ...(labelDelta.updates[l.id] ?? {}) }))
        .filter((l) => !labelBaseIds.has(l.id)),
    ];

    return {
      ...tenantBaseSnapshot,
      permissionOverrides,
      departments: [...tenantBaseSnapshot.departments, ...addedDepartments],
      profiles,
      campaigns,
      accounts: accountsMerged,
      contacts: contactsMerged,
      leads: leadsMerged,
      users: usersMerged,
      crmLabels,
    };
  }, [
    tenantBaseSnapshot,
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
    labelDelta,
  ]);

  const snapshot = React.useMemo((): WorkspaceSnapshot => {
    const merged = mergeSessionIntoSnapshot(preSessionSnapshot, sessionV2);
    const planPatches = sessionV2.followupPlans.patches;
    const followupPlans = mergeFollowupPlans(merged.followupPlans ?? [], merged.followups).map(
      (p) => (planPatches[p.id] ? { ...p, ...planPatches[p.id] } : p),
    );
    return { ...preSessionSnapshot, ...merged, followupPlans };
  }, [preSessionSnapshot, sessionV2]);

  snapshotRef.current = snapshot;

  const setLeadTaskCompleted = React.useCallback(
    (id: string, completed: boolean) => {
      const writeFs =
        mode === "live" && isFirebaseWebConfigured() && Boolean(userDoc?.organizationId);
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = getFirebaseDb();
            await persistLeadTaskSetCompleted(db, id, completed);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error("Could not update task", { description: msg });
          }
        })();
      }
      const iso = new Date().toISOString();
      setSessionV2((s) => {
        const completion = { ...s.leadTasks.completion };
        if (completed) completion[id] = iso;
        else completion[id] = null;
        return {
          ...s,
          leadTasks: { ...s.leadTasks, completion },
        };
      });
    },
    [mode, userDoc?.organizationId],
  );

  const value = React.useMemo<WorkspaceContextValue>(() => {
    const snapshotWithIdle = { ...snapshot, leads: enrichLeadsIdleState(snapshot.leads) };
    const lookup = createWorkspaceLookup(snapshotWithIdle);
    const getOwnerDisplayName = (uid: string): string | undefined => {
      const id = uid?.trim();
      if (!id) return undefined;
      const fromUser = snapshotWithIdle.users.find((u) => u.id === id)?.displayName?.trim();
      if (fromUser) return fromUser;
      return orgMemberLabels[id]?.trim() || undefined;
    };
    const viewerRole: OrgMemberRole =
      snapshotWithIdle.users.find((u) => u.id === snapshotWithIdle.currentUserId)?.orgRole ?? "member";
    const canDeleteLeads = viewerRole === "owner" || viewerRole === "admin";
    const canEditLead = (lead: Lead) => canEditProspectDerivedLead(lead, viewerRole);
    const viewer =
      snapshotWithIdle.users.find((u) => u.id === snapshotWithIdle.currentUserId) ??
      (userDoc && fbUser?.uid ? ({ ...userDoc, id: fbUser.uid } as User) : undefined);
    const reportIds = viewer
      ? collectDescendantUserIds(viewer.id, snapshotWithIdle.users)
      : new Set<string>();
    const canViewMemberMailboxes =
      roleAtLeast(viewerRole, "admin") || reportIds.size > 0 || delegatedMailboxHostIds.length > 0;
    const hierarchyMailboxIds = canViewMemberMailboxes
      ? roleAtLeast(viewerRole, "admin")
        ? snapshotWithIdle.users
            .filter((u) => u.status === "active" && u.id && u.id !== snapshotWithIdle.currentUserId)
            .map((u) => u.id)
        : [...reportIds]
      : [];
    const mailboxViewableUserIds = [
      ...new Set([...hierarchyMailboxIds, ...delegatedMailboxHostIds]),
    ].filter((id) => id && id !== snapshotWithIdle.currentUserId);
    return {
      ...snapshotWithIdle,
      ...lookup,
      mode,
      isDemo: mode === "demo",
      demoPersonaId,
      organizationId: liveOrgId,
      organizationName,
      liveFirestoreError: mode === "live" ? liveFs.error : null,
      userProfileError: mode === "live" && fbUser ? userProfileLoadError ?? null : null,
      workspaceLoading: mode === "live" ? liveFs.loading : demoSnapshot == null,
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
      stageCrmEntities,
      patchUser,
      sessionHydrated,
      addFollowup,
      createFollowupPlanWithFollowups,
      setFollowupCompleted,
      setFollowupEmailSchedule,
      clearFollowupEmailSchedule,
      removeFollowup,
      pauseFollowupPlanForReply,
      supersedeFollowupPlan,
      addLeadTask,
      setLeadTaskCompleted,
      addLeadNote,
      updateLeadNote,
      deleteLeadNote,
      addLeadTouchpoint,
      addTimelineEvent,
      patchLead,
      patchLeadAsync,
      patchAccount,
      patchContact,
      patchDeal,
      addCrmLabel,
      updateCrmLabel,
      removeCrmLabel,
      deleteLead,
      canDeleteLeads,
      canEditLead,
      viewerOrgRole: viewerRole,
      canViewMemberMailboxes,
      mailboxViewableUserIds,
      updateLeadStage,
      toggleLeadPin,
      isLeadPinned,
      bumpLeadActivity,
      getOwnerDisplayName,
    };
  }, [
    snapshot,
    orgMemberLabels,
    delegatedMailboxHostIds,
    mode,
    demoPersonaId,
    liveOrgId,
    organizationName,
    liveFs.error,
    liveFs.loading,
    demoSnapshot,
    userProfileLoadError,
    fbUser,
    userDoc,
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
    stageCrmEntities,
    patchUser,
    sessionHydrated,
    addFollowup,
    createFollowupPlanWithFollowups,
    setFollowupCompleted,
    setFollowupEmailSchedule,
    clearFollowupEmailSchedule,
    removeFollowup,
    pauseFollowupPlanForReply,
    supersedeFollowupPlan,
    addLeadTask,
    setLeadTaskCompleted,
    addLeadNote,
    updateLeadNote,
    deleteLeadNote,
    addLeadTouchpoint,
    addTimelineEvent,
    patchLead,
    patchLeadAsync,
    patchAccount,
    patchContact,
    patchDeal,
    addCrmLabel,
    updateCrmLabel,
    removeCrmLabel,
    deleteLead,
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
