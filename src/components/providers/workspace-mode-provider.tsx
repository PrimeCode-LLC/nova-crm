"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import type { WorkspaceMode } from "@/lib/workspace-mode";
import type { WorkspaceListenerGroup } from "@/lib/workspace-listener-groups";
import {
  CORE_WORKSPACE_GROUPS,
  expireUnusedWorkspaceGroups,
  groupsForPathname,
  mergeWorkspaceGroups,
  workspaceGroupsKey,
} from "@/lib/workspace-listener-groups";
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
  PermissionOverride,
  PipelineStage,
  Profile,
  Touchpoint,
  TimelineEvent,
  User,
  CrmLabel,
  Deal,
  OrgActivityEvent,
  OrgMemberRole,
  OrgEmailSendPolicy,
} from "@/lib/types";
import { useOrgMembers } from "@/hooks/use-org-members";
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
import { useSessionUserProfile } from "@/lib/hooks/use-session-user-profile";
import { useLiveWorkspaceFirestore } from "@/lib/hooks/use-live-workspace-data";
import { isClientDocumentSyncEnabled } from "@/lib/db/document-access/config";
import { getClientDb } from "@/lib/db/document-access/client";
import { isPostgresSoleWriterCrmV1Enabled } from "@/lib/db/postgres-sole-writer-crm-flags";
import { resolveOrganizationIdForFirestoreWrite } from "@/lib/db/document-access/resolve-organization-id-for-write";
import { COLLECTIONS } from "@/lib/documents/collections";
import { groupTimelineEventsByLead } from "@/lib/documents/group-timeline-events";
import {
  persistAccountCreateClient,
  persistContactCreateClient,
  persistLeadCreateClient,
} from "@/lib/documents/persist-lead-graph-client";
import { persistLeadPatchClient } from "@/lib/documents/persist-lead-patch-client";
import { persistBulkOwnerReassignClient } from "@/lib/documents/persist-bulk-owner-reassign-client";
import type { BulkOwnerReassignItem } from "@/lib/documents/persist-bulk-owner-reassign-client";
import { createUserNotifications, actorLabel } from "@/lib/notifications/create-user-notification";
import { buildOwnershipHandoffNotifications } from "@/lib/notifications/ownership-handoff";
import { persistUserNotificationDismiss } from "@/lib/notifications/persist-user-notification-client";
import { useDemoUserNotifications } from "@/stores/demo-user-notifications-store";
import { persistAccountPatchClient } from "@/lib/documents/persist-account-patch-client";
import { persistContactPatchClient } from "@/lib/documents/persist-contact-patch-client";
import { persistDealPatchClient } from "@/lib/documents/persist-deal-patch-client";
import {
  persistCrmLabelCreate,
  persistCrmLabelDelete,
  persistCrmLabelUpdate,
} from "@/lib/documents/persist-crm-label-client";
import { persistLeadDeleteClient } from "@/lib/documents/persist-lead-delete-client";
import {
  persistFollowupCreate,
  persistFollowupDelete,
  persistFollowupEmailSchedule,
  persistFollowupPatch,
  persistFollowupSetCompleted,
  persistFollowupSetPaused,
  persistFollowupPlanCreate,
  persistFollowupPlanPatch,
  persistFollowupPlanSupersede,
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
  persistDepartmentCreate,
  persistDepartmentUpdate,
  persistPermissionOverrideCreate,
  persistPermissionOverrideDelete,
} from "@/lib/documents/persist-workspace-entities-client";
import { persistOrgActivityEventCreate } from "@/lib/documents/persist-org-activity-client";
import { doc, serverTimestamp, updateDoc } from "@/lib/db/document-shim/shim-client-firestore";
import { toast } from "sonner";
import { toastError } from "@/lib/error-logging/toast-error";
import { isAuthDisabled } from "@/lib/auth/flags";
import {
  DEFAULT_ORG_SEND_POLICY,
  resolveOrgSendPolicy,
} from "@/lib/email/org-send-policy";
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
} from "@/lib/documents/audit-change-client";
import { leadDisplayLabel } from "@/lib/leads/lead-display-label";
import { emitBulkLeadOrgActivity } from "@/lib/leads/record-bulk-lead-org-activity";
import { fetchLeadByIdClient } from "@/lib/leads/fetch-lead-by-id-client";
import { fetchLeadOwnerIdClient } from "@/lib/leads/fetch-lead-owner-id-client";
import { useInvalidateDashboardKpis } from "@/hooks/use-dashboard-kpis";
import {
  isDashboardKpiApiV2Enabled,
  isLiveCrmSnapshotDisabled,
  isWorkspaceCrmSnapshotOff,
} from "@/lib/dashboard-kpi-v2-flags";
import { peekCrmEntity, rememberCrmEntities, subscribeCrmEntityCache } from "@/lib/crm/entity-cache";
import { withCachedSessionTargets } from "@/lib/crm/session-snapshot-seed";
import { fetchAccountByIdClient } from "@/lib/crm/fetch-crm-entity-by-id-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildArchivePatch,
  buildRestoreAsProspectPatch,
  buildRestorePatch,
  isLeadArchived,
  type LeadArchiveReason,
} from "@/lib/leads/lead-archive";
import { enrichLeadsIdleState } from "@/lib/lead-idle";
import { mergeFollowupPlans, SUPERSEDED_STEP_CANCEL_REASON } from "@/lib/followup-plans";
import {
  normalizeFollowupTitle,
  resolveFollowupOwnerId,
} from "@/lib/followup-due-display";
import { roleAtLeast } from "@/lib/platform/org-role";
import { canAction } from "@/lib/permissions/can";
import {
  canEditProspectDerivedLead,
  isProspectRow,
  prospectPatchForSalesLeadSync,
} from "@/lib/prospects/prospect-access";
import { defaultIntentPlaybook } from "@/lib/intent/playbook-templates";
import { parseIntentPlaybook } from "@/lib/intent/parse-playbook";
import {
  withInitialQualityScore,
  withQualityScorePatch,
} from "@/lib/intent/apply-quality-score";
import type { IntentPlaybook } from "@/lib/intent/types";

export type WorkspaceContextValue = WorkspaceSnapshot &
  WorkspaceLookup & {
    mode: WorkspaceMode;
    isDemo: boolean;
    demoPersonaId: string;
    /** Live mode: tenant id from the signed-in user doc (for writes / diagnostics). */
    organizationId?: string;
    /** Org Intent Playbook used for Quality Score (defaults to modernization template). */
    intentPlaybook: IntentPlaybook;
    /** Replace the in-memory playbook after admin save (also persists via API). */
    setIntentPlaybook: (playbook: IntentPlaybook) => void;
    /** Display name for the signed-in tenant (from Firestore org). */
    organizationName: string;
    /**
     * Sticky org IANA timezone when set; empty/undefined means fall back to browser.
     * Use `resolveOrgTimezone(organizationTimezone)` for the effective zone.
     */
    organizationTimezone?: string;
    /** Org email working hours + optional daily ceiling for auto/bulk scheduling. */
    organizationSendPolicy: OrgEmailSendPolicy;
    /** Live mode: Firestore workspace listeners hit an error (partial data may be stale). */
    liveFirestoreError: Error | null;
    /** Live mode: listener for the signed-in user document failed. */
    userProfileError: Error | null;
    /** True while workspace data is still loading (live Firestore or demo bundle). */
    workspaceLoading: boolean;
    /** Live: followups listener has delivered its first snapshot (page can leave skeleton). */
    followupsReady: boolean;
    setMode: (next: WorkspaceMode) => Promise<void>;
    setDemoPersona: (userId: string) => Promise<void>;
    addPermissionOverride: (override: PermissionOverride) => void;
    removePermissionOverride: (id: string) => void;
    addDepartment: (dept: Department) => void;
    updateDepartment: (id: string, patch: Partial<Omit<Department, "id">>) => void;
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
    createFollowupPlanWithFollowups: (
      plan: FollowupPlan,
      followups: Followup[],
      options?: { skipTimeline?: boolean },
    ) => void;
    setFollowupCompleted: (id: string, completed: boolean) => void;
    setFollowupEmailSchedule: (
      id: string,
      schedule:
        | {
            scheduledEmailId: string;
            emailScheduledAt: string;
            freshThread?: boolean;
            mailboxId?: string;
            fromEmail?: string;
            toEmail?: string;
            mailboxOwnerUid?: string;
          }
        | null,
    ) => void;
    clearFollowupEmailSchedule: (id: string) => void;
    /** Apply server/demo delivery lifecycle fields to the local workspace snapshot. */
    syncFollowupDelivery: (
      id: string,
      patch: Pick<
        Followup,
        "deliveryStatus" | "sentAt" | "failedAt" | "cancelledAt" | "deliveryError" | "cancelReason"
      >,
    ) => void;
    removeFollowup: (id: string) => void;
    updateFollowup: (
      id: string,
      patch: Partial<
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
      >,
    ) => void;
    pauseFollowupPlanForReply: (input: {
      planId: string;
      leadId: string;
      reason: string;
      replyMessageId?: string;
      actorId: string;
      openFollowupIds: string[];
    }) => Promise<void>;
    /** Resume a bounce/reply-paused plan and clear pausedAt on listed followups. */
    resumeFollowupPlan: (input: {
      planId: string;
      leadId: string;
      openFollowupIds: string[];
      actorId?: string;
    }) => Promise<void>;
    supersedeFollowupPlan: (
      oldPlanId: string,
      newPlanId: string,
      /** Unsent steps of the old plan to cancel; cancel linked sends first. */
      retireFollowupIds?: readonly string[],
    ) => void;
    addLeadTask: (t: LeadTask) => void;
    setLeadTaskCompleted: (id: string, completed: boolean) => void;
    addLeadNote: (leadId: string, body: string, authorId: string) => void;
    updateLeadNote: (noteId: string, patch: Partial<Pick<Note, "body" | "pinned">>) => void;
    deleteLeadNote: (noteId: string) => void;
    addLeadTouchpoint: (t: Touchpoint) => void;
    addTimelineEvent: (e: TimelineEvent) => void;
    addOrgActivityEvent: (e: OrgActivityEvent) => void;
    patchLead: (leadId: string, patch: Partial<Lead>) => void;
    /** Like `patchLead` but awaits the Firestore write (live mode). Throws on permission or network errors. */
    patchLeadAsync: (leadId: string, patch: Partial<Lead>) => Promise<void>;
    /**
     * Session-only lead patch after the server already persisted (no Firestore write,
     * no prospect-derived edit gate). Use for hydrate-from-API flows.
     */
    applyLeadLocalPatch: (leadId: string, patch: Partial<Lead>) => void;
    /**
     * Bulk owner reassignment via Firestore write batches (live) or a single session update (demo).
     * Prefer this over looping `patchLeadAsync` for large selections.
     */
    bulkReassignOwners: (
      items: BulkOwnerReassignItem[],
      nextOwnerId: string,
      onProgress?: (done: number, total: number) => void,
    ) => Promise<void>;
    patchAccount: (accountId: string, patch: Partial<Account>) => void;
    patchContact: (contactId: string, patch: Partial<Contact>) => void;
    /** Removes a lead (org owner or admin only in live). Resolves `true` if removed or queued successfully. */
    deleteLead: (
      leadId: string,
      options?: { quiet?: boolean; skipActivity?: boolean },
    ) => Promise<boolean>;
    /** Soft-archive a lead/prospect (hides from active lists). */
    archiveLead: (
      leadId: string,
      options?: { reason?: LeadArchiveReason; quiet?: boolean; skipActivity?: boolean },
    ) => Promise<boolean>;
    /** Restore from archive; optionally land in Prospects. */
    restoreLead: (
      leadId: string,
      options?: { asProspect?: boolean; quiet?: boolean; skipActivity?: boolean },
    ) => Promise<boolean>;
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
    /**
     * Live org member uids with `status === "active"` (from `/api/org/members`).
     * `null` while loading or when not in a live org — callers should fall back to CRM `users` status.
     */
    activeOrgMemberIds: ReadonlySet<string> | null;
    addCrmLabel: (label: CrmLabel) => void;
    updateCrmLabel: (id: string, patch: Partial<Pick<CrmLabel, "name" | "color">>) => void;
    removeCrmLabel: (id: string) => void;
    patchDeal: (dealId: string, patch: Partial<Deal>) => void;
    /**
     * Request sticky Firestore listener groups (e.g. `directory` when opening QuickAdd).
     * Groups stay attached for the rest of the session.
     */
    requestWorkspaceGroups: (groups: readonly WorkspaceListenerGroup[]) => void;
  };

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

function newLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

async function leadRowForMutation(
  leadId: string,
  organizationId: string | undefined,
  snapLeads: readonly Lead[],
): Promise<Lead | undefined> {
  const fromSnap = snapLeads.find((lead) => lead.id === leadId);
  if (fromSnap) return fromSnap;
  const cached = peekCrmEntity("leads", leadId);
  if (cached) return cached;
  if (!isWorkspaceCrmSnapshotOff() || !organizationId) return undefined;
  const fetched = await fetchLeadByIdClient({ leadId, organizationId });
  if (fetched.status !== "ok") return undefined;
  rememberCrmEntities("leads", [fetched.lead]);
  if (fetched.account) rememberCrmEntities("accounts", [fetched.account]);
  if (fetched.contact) rememberCrmEntities("contacts", [fetched.contact]);
  return fetched.lead;
}

export function WorkspaceModeProvider({
  initialMode,
  initialDemoPersonaId,
  organizationName: organizationNameProp,
  organizationTimezone: organizationTimezoneProp,
  organizationSendPolicy: organizationSendPolicyProp,
  children,
}: {
  initialMode: WorkspaceMode;
  initialDemoPersonaId: string;
  /** Resolved on the server from the session’s organizationId; fallback label if missing. */
  organizationName?: string | null;
  /** Optional sticky org IANA timezone from Organization.settings.timezone. */
  organizationTimezone?: string | null;
  organizationSendPolicy?: OrgEmailSendPolicy | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const queryClient = useQueryClient();
  const [crmCacheEpoch, setCrmCacheEpoch] = React.useState(0);
  React.useEffect(() => subscribeCrmEntityCache(() => setCrmCacheEpoch((n) => n + 1)), []);
  const invalidateDashboardKpis = useInvalidateDashboardKpis();
  const bumpDashboardKpis = React.useCallback(() => {
    if (isDashboardKpiApiV2Enabled()) invalidateDashboardKpis();
  }, [invalidateDashboardKpis]);
  const [mode, setModeState] = React.useState<WorkspaceMode>(initialMode);
  const [demoPersonaId, setDemoPersonaState] = React.useState(initialDemoPersonaId);
  const [demoSnapshot, setDemoSnapshot] = React.useState<WorkspaceSnapshot | null>(null);
  const snapshotRef = React.useRef<WorkspaceSnapshot>(LIVE_SNAPSHOT);

  /** Route + dialog listener groups; non-core entries expire after a grace period off-route. */
  const [requestedGroups, setRequestedGroups] = React.useState<Set<WorkspaceListenerGroup>>(
    () => mergeWorkspaceGroups(CORE_WORKSPACE_GROUPS, groupsForPathname(pathname)),
  );
  const requestedGroupsKey = workspaceGroupsKey(requestedGroups);
  const lastNeededAtRef = React.useRef(new Map<WorkspaceListenerGroup, number>());

  const touchGroups = React.useCallback((groups: readonly WorkspaceListenerGroup[], now = Date.now()) => {
    for (const g of groups) {
      if (g === "core") continue;
      lastNeededAtRef.current.set(g, now);
    }
  }, []);

  const pruneExpiredGroups = React.useCallback((stillNeeded: ReadonlySet<WorkspaceListenerGroup>) => {
    setRequestedGroups((prev) => {
      const next = expireUnusedWorkspaceGroups({
        current: prev,
        lastNeededAt: lastNeededAtRef.current,
        stillNeeded,
        now: Date.now(),
      });
      if (next.size === prev.size && [...next].every((g) => prev.has(g))) return prev;
      for (const g of prev) {
        if (!next.has(g)) lastNeededAtRef.current.delete(g);
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    const routeGroups = groupsForPathname(pathname);
    const now = Date.now();
    touchGroups(routeGroups, now);
    if (routeGroups.length > 0) {
      setRequestedGroups((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const g of routeGroups) {
          if (!next.has(g)) {
            next.add(g);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    pruneExpiredGroups(new Set(routeGroups));
  }, [pathname, touchGroups, pruneExpiredGroups]);

  // Periodic prune so groups expire even if the user stays on a shell route.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      pruneExpiredGroups(new Set(groupsForPathname(pathname)));
    }, 60_000);
    return () => window.clearInterval(id);
  }, [pathname, pruneExpiredGroups]);

  const requestWorkspaceGroups = React.useCallback(
    (groups: readonly WorkspaceListenerGroup[]) => {
      if (groups.length === 0) return;
      touchGroups(groups);
      setRequestedGroups((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const g of groups) {
          if (!next.has(g)) {
            next.add(g);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [touchGroups],
  );

  const organizationName =
    organizationNameProp?.trim() || "Workspace";
  const organizationTimezone = organizationTimezoneProp?.trim() || undefined;
  const organizationSendPolicy = resolveOrgSendPolicy(
    organizationSendPolicyProp ?? DEFAULT_ORG_SEND_POLICY,
  );

  const [intentPlaybook, setIntentPlaybookState] = React.useState<IntentPlaybook>(() =>
    defaultIntentPlaybook(),
  );
  const intentPlaybookRef = React.useRef(intentPlaybook);
  intentPlaybookRef.current = intentPlaybook;

  const setIntentPlaybook = React.useCallback((playbook: IntentPlaybook) => {
    setIntentPlaybookState(parseIntentPlaybook(playbook));
  }, []);

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
  const [departmentPatches, setDepartmentPatches] = React.useState<
    Record<string, Partial<Omit<Department, "id">>>
  >({});

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
  /** Preserves `users` array/object identity across unrelated snapshot rebuilds (leads, notes, etc.). */
  const stableUsersMergedRef = React.useRef<User[]>([]);
  const [accountContactBumps, setAccountContactBumps] = React.useState<Record<string, number>>({});

  const [labelDelta, setLabelDelta] = React.useState<{
    added: CrmLabel[];
    removedIds: string[];
    updates: Record<string, Partial<Pick<CrmLabel, "name" | "color">>>;
  }>({ added: [], removedIds: [], updates: {} });

  const liveDbOrNull = React.useCallback((): ReturnType<typeof getClientDb> | null => {
    return isClientDocumentSyncEnabled() ? getClientDb() : null;
  }, []);
  const requireLiveDb = React.useCallback((): ReturnType<typeof getClientDb> => {
    const db = liveDbOrNull();
    if (!db) throw new Error("Firestore is not configured");
    return db;
  }, [liveDbOrNull]);

  const [sessionV2, setSessionV2] = React.useState<WorkspaceSessionV2>(() => emptyWorkspaceSession());
  const [sessionHydrated, setSessionHydrated] = React.useState(false);

  const firebaseLive = isClientDocumentSyncEnabled();
  const { user: fbUser, loading: authLoading } = useAuth();
  const sessionProfile = useSessionUserProfile(
    mode === "live" && !firebaseLive,
  );
  const {
    data: fsUserDoc,
    error: userProfileLoadError,
    loading: userDocLoading,
  } = useUserDoc(
    mode === "demo" || isAuthDisabled() || !firebaseLive || !fbUser
      ? undefined
      : fbUser.uid,
  );
  const userDoc = firebaseLive ? fsUserDoc : sessionProfile.data;
  const viewerUid = firebaseLive ? fbUser?.uid : sessionProfile.uid;
  const identityLoading = firebaseLive ? authLoading : sessionProfile.loading;
  /** CRM accounts/contacts/leads/deals: Postgres sole-writer or Firestore. */
  const canPersistCrmLive = React.useCallback(
    () =>
      mode === "live" &&
      Boolean(userDoc?.organizationId) &&
      (isPostgresSoleWriterCrmV1Enabled() || isClientDocumentSyncEnabled()),
    [mode, userDoc?.organizationId],
  );
  /**
   * pg_documents entities (followups/plans, notes, tasks, labels, etc.) that still
   * write through the client document shim → /api/org/workspace-documents.
   * Client Firestore sync is permanently off; CRM tables use canPersistCrmLive instead.
   */
  const canPersistWorkspaceDocsLive = React.useCallback(
    () => mode === "live" && Boolean(userDoc?.organizationId),
    [mode, userDoc?.organizationId],
  );
  /** Shim db handle for workspace-documents writes (not real Firestore). */
  const requireWorkspaceDb = React.useCallback(() => getClientDb(), []);
  const liveOrgId =
    mode === "live" && userDoc?.organizationId ? userDoc.organizationId : undefined;
  const viewerForMemberScope = React.useMemo((): User | null => {
    if (!userDoc || !viewerUid) return null;
    return { ...userDoc, id: viewerUid };
  }, [viewerUid, userDoc]);

  React.useEffect(() => {
    if (mode === "demo") {
      setIntentPlaybookState(defaultIntentPlaybook());
      return;
    }
    if (!liveOrgId) return;
    let cancelled = false;
    void fetch("/api/org/intent-playbook")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { playbook?: unknown };
        if (!cancelled && data.playbook) {
          setIntentPlaybookState(parseIntentPlaybook(data.playbook));
        }
      })
      .catch(() => {
        /* keep default playbook */
      });
    return () => {
      cancelled = true;
    };
  }, [mode, liveOrgId]);

  /** Align Firestore queries with rules: narrow unless viewer sees the full tenant (directors / owner / admin / manager org roles). */
  const narrowMemberCrm = viewerForMemberScope
    ? !seesAllLeadsInTenant(viewerForMemberScope)
    : userDoc?.orgRole === "member";
  const liveFs = useLiveWorkspaceFirestore(
    liveOrgId,
    viewerUid,
    narrowMemberCrm,
    viewerForMemberScope,
    requestedGroups,
  );

  const liveLeadsForPersistRef = React.useRef<Lead[]>([]);
  React.useEffect(() => {
    liveLeadsForPersistRef.current = liveFs.leads;
  }, [liveFs.leads]);

  const leadOwnerCacheRef = React.useRef<Map<string, string>>(new Map());

  const resolveLeadOwnerIdForFirestore = React.useCallback(async (leadId: string) => {
    const id = leadId.trim();
    if (!id) return "";
    const fromLive = liveLeadsForPersistRef.current.find((l) => l.id === id)?.ownerId?.trim();
    if (fromLive) return fromLive;
    const fromCache = peekCrmEntity("leads", id)?.ownerId?.trim();
    if (fromCache) return fromCache;
    const fromSnapshot = snapshotRef.current.leads.find((l) => l.id === id)?.ownerId?.trim();
    if (fromSnapshot) return fromSnapshot;
    if (leadOwnerCacheRef.current.has(id)) {
      return leadOwnerCacheRef.current.get(id) ?? "";
    }
    const ownerId = await fetchLeadOwnerIdClient(id);
    leadOwnerCacheRef.current.set(id, ownerId);
    return ownerId;
  }, []);

  const [orgMemberLabels, setOrgMemberLabels] = React.useState<Record<string, string>>({});
  const [activeOrgMemberIds, setActiveOrgMemberIds] = React.useState<ReadonlySet<string> | null>(
    null,
  );
  const [delegatedMailboxHostIds, setDelegatedMailboxHostIds] = React.useState<string[]>([]);
  const orgMembersQuery = useOrgMembers(Boolean(liveOrgId));
  React.useEffect(() => {
    if (!liveOrgId) {
      setOrgMemberLabels({});
      setActiveOrgMemberIds(null);
      return;
    }
    const members = orgMembersQuery.data;
    if (!members) {
      if (orgMembersQuery.isError) {
        setOrgMemberLabels({});
        setActiveOrgMemberIds(null);
      }
      return;
    }
    const next: Record<string, string> = {};
    const activeIds = new Set<string>();
    for (const m of members) {
      const label =
        m.displayName?.trim() ||
        (m.email.includes("@") ? m.email.split("@")[0] : m.email) ||
        m.uid;
      next[m.uid] = label;
      if (m.status === "active") activeIds.add(m.uid);
    }
    setOrgMemberLabels(next);
    setActiveOrgMemberIds(activeIds);
  }, [liveOrgId, orgMembersQuery.data, orgMembersQuery.isError]);

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
    setDepartmentPatches({});
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

  const addPermissionOverride = React.useCallback(
    (override: PermissionOverride) => {
      setPoDelta((d) => ({ ...d, added: [...d.added, override] }));
      if (!canPersistWorkspaceDocsLive()) return;
      const orgId = userDoc?.organizationId;
      if (!orgId) return;
      void (async () => {
        try {
          const db = requireWorkspaceDb();
          await persistPermissionOverrideCreate(db, orgId, override);
        } catch (e) {
          toastError("Could not save permission override", e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "workspacePersist",
          });
        }
      })();
    },
    [mode, userDoc?.organizationId],
  );

  const removePermissionOverride = React.useCallback(
    (id: string) => {
      setPoDelta((d) => {
        const added = d.added.filter((x) => x.id !== id);
        if (added.length !== d.added.length) {
          return { ...d, added };
        }
        if (d.removedIds.includes(id)) return d;
        return { ...d, removedIds: [...d.removedIds, id] };
      });
      if (!canPersistWorkspaceDocsLive()) return;
      void (async () => {
        try {
          const db = requireWorkspaceDb();
          await persistPermissionOverrideDelete(db, id);
        } catch (e) {
          toastError("Could not remove permission override", e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "workspacePersist",
          });
        }
      })();
    },
    [mode, userDoc?.organizationId],
  );

  const addDepartment = React.useCallback(
    (dept: Department) => {
      setAddedDepartments((prev) => [...prev, dept]);
      if (!canPersistWorkspaceDocsLive()) return;
      const orgId = userDoc?.organizationId;
      if (!orgId) return;
      void (async () => {
        try {
          const db = requireWorkspaceDb();
          await persistDepartmentCreate(db, orgId, dept);
        } catch (e) {
          toastError("Could not save team", e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "workspacePersist",
          });
        }
      })();
    },
    [mode, userDoc?.organizationId],
  );

  const updateDepartment = React.useCallback(
    (id: string, patch: Partial<Omit<Department, "id">>) => {
      setAddedDepartments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      );
      setDepartmentPatches((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...patch },
      }));
      if (!canPersistWorkspaceDocsLive()) return;
      void (async () => {
        try {
          const db = requireWorkspaceDb();
          await persistDepartmentUpdate(db, id, patch);
        } catch (e) {
          toastError("Could not update team", e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "workspacePersist",
          });
        }
      })();
    },
    [mode, userDoc?.organizationId],
  );

  const updateProfile = React.useCallback(
    (id: string, patch: Partial<Profile>) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistProfileUpdate(db, id, patch);
          } catch (e) {
            toastError("Could not save profile", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistProfileCreate(db, orgId, profile);
          } catch (e) {
            toastError("Could not save profile", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistCampaignUpdate(db, id, patch);
          } catch (e) {
            console.error(e);
            toastError("Could not save campaign", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "updateCampaign",
            });
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
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            const orgId = userDoc!.organizationId!;
            await persistCampaignCreate(db, orgId, campaign);
          } catch (e) {
            console.error(e);
            toastError("Could not create campaign", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "addCampaign",
            });
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
        canPersistCrmLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        try {
          const db = liveDbOrNull();
          await persistAccountCreateClient(db, orgId, account);
        } catch (e) {
            toastError("Could not save company", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistCrmLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        try {
          const db = liveDbOrNull();
          await persistContactCreateClient(db, orgId, contact);
        } catch (e) {
            toastError("Could not save contact", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
      const scored = withInitialQualityScore(
        lead,
        intentPlaybookRef.current,
        snapshotRef.current.crmLabels,
      );
      const writeFs =
        canPersistCrmLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        try {
          const db = liveDbOrNull();
          await persistLeadCreateClient(db, orgId, scored);
          recordLeadCreatedClient({
            leadId: scored.id,
            leadName: leadDisplayLabel(scored),
            channel: scored.channel,
            isProspect: isProspectRow(scored),
          });
        } catch (e) {
            toastError("Could not save lead", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          throw e;
        }
      }
      setLeadsAdded((prev) => [...prev, scored]);
    },
    [mode, userDoc?.organizationId],
  );

  const stageCrmEntities = React.useCallback(
    (payload: { leads?: Lead[]; accounts?: Account[]; contacts?: Contact[] }) => {
      if (payload.accounts?.length) {
        rememberCrmEntities("accounts", payload.accounts);
        setAccountsAdded((prev) => {
          const ids = new Set(prev.map((a) => a.id));
          return [...prev, ...payload.accounts!.filter((a) => !ids.has(a.id))];
        });
      }
      if (payload.contacts?.length) {
        rememberCrmEntities("contacts", payload.contacts);
        setContactsAdded((prev) => {
          const ids = new Set(prev.map((c) => c.id));
          return [...prev, ...payload.contacts!.filter((c) => !ids.has(c.id))];
        });
      }
      if (payload.leads?.length) {
        rememberCrmEntities("leads", payload.leads);
        setLeadsAdded((prev) => {
          const ids = new Set(prev.map((l) => l.id));
          return [...prev, ...payload.leads!.filter((l) => !ids.has(l.id))];
        });
      }
      if (isWorkspaceCrmSnapshotOff()) {
        void queryClient.invalidateQueries({ queryKey: ["org", "crm-pages"] });
        void queryClient.invalidateQueries({ queryKey: ["org", "kanban-stage"] });
      }
    },
    [queryClient],
  );

  const patchUser = React.useCallback((userId: string, patch: Partial<Omit<User, "id">>) => {
    setUserPatches((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));
  }, []);

  const bumpLeadActivity = React.useCallback(
    (leadId: string) => {
      const writeFs =
        canPersistCrmLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = liveDbOrNull();
            await persistLeadActivityBump(db, leadId);
          } catch (e) {
            toastError("Could not update activity", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
      const actorId = viewerUid?.trim() || f.ownerId || "";
      const normalized: Followup = {
        ...f,
        title: normalizeFollowupTitle({
          title: f.title,
          emailSubject: f.emailSubject,
          channel: f.channel,
        }),
        ownerId: resolveFollowupOwnerId(f.ownerId, actorId),
      };
      const iso = new Date().toISOString();
      const timeline: TimelineEvent | null =
        normalized.leadId
          ? {
              id: newLocalId("te-local"),
              leadId: normalized.leadId,
              type: "followup_created",
              actorId: normalized.ownerId,
              summary: `Scheduled follow-up: ${normalized.title}`,
              createdAt: iso,
              payload: { followupId: normalized.id },
            }
          : null;
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistFollowupCreate(db, orgId, normalized);
            if (normalized.leadId) await persistLeadActivityBump(db, normalized.leadId);
            if (timeline) {
              await persistTimelineEventCreate(
                db,
                orgId,
                timeline,
                await resolveLeadOwnerIdForFirestore(normalized.leadId!),
              );
            }
          } catch (e) {
            toastError("Could not save follow-up", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      }
      setSessionV2((s) => {
        const next: WorkspaceSessionV2 = {
          ...s,
          followups: { ...s.followups, extras: [...s.followups.extras, normalized] },
          timelineAdded: timeline ? [...s.timelineAdded, timeline] : s.timelineAdded,
        };
        if (!normalized.leadId) return next;
        if (writeFs) return next;
        return {
          ...next,
          leadActivity: {
            ...next.leadActivity,
            [normalized.leadId]: {
              bump: (next.leadActivity[normalized.leadId]?.bump ?? 0) + 1,
              lastAt: iso,
            },
          },
        };
      });
    },
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore, viewerUid],
  );

  const createFollowupPlanWithFollowups = React.useCallback(
    (plan: FollowupPlan, items: Followup[], options?: { skipTimeline?: boolean }) => {
      const actorId = viewerUid?.trim() || plan.ownerId || "";
      const normalizedPlan: FollowupPlan = {
        ...plan,
        ownerId: resolveFollowupOwnerId(plan.ownerId, actorId),
      };
      const normalizedItems = items.map((f, i) => ({
        ...f,
        title: normalizeFollowupTitle({
          title: f.title,
          emailSubject: f.emailSubject,
          channel: f.channel,
          stepIndex: i,
        }),
        ownerId: resolveFollowupOwnerId(f.ownerId, actorId),
      }));
      const iso = new Date().toISOString();
      const skipTimeline = options?.skipTimeline === true;
      const timelines: TimelineEvent[] = skipTimeline
        ? []
        : normalizedItems
            .filter((f): f is Followup & { leadId: string } => Boolean(f.leadId))
            .map((f) => ({
              id: newLocalId("te-local"),
              leadId: f.leadId,
              type: "followup_created" as const,
              actorId: f.ownerId || normalizedPlan.ownerId,
              summary: `Scheduled follow-up: ${f.title}`,
              createdAt: iso,
              payload: { followupId: f.id, planId: normalizedPlan.id },
            }));
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistFollowupPlanCreate(db, orgId, normalizedPlan);
            for (const f of normalizedItems) {
              await persistFollowupCreate(db, orgId, f);
            }
            if (normalizedPlan.leadId) await persistLeadActivityBump(db, normalizedPlan.leadId);
            for (const te of timelines) {
              await persistTimelineEventCreate(
                db,
                orgId,
                te,
                await resolveLeadOwnerIdForFirestore(te.leadId),
              );
            }
          } catch (e) {
            toastError("Could not save follow-up plan", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        followupPlans: {
          ...s.followupPlans,
          extras: [...s.followupPlans.extras, normalizedPlan],
        },
        followups: {
          ...s.followups,
          extras: [...s.followups.extras, ...normalizedItems],
        },
        timelineAdded: timelines.length ? [...s.timelineAdded, ...timelines] : s.timelineAdded,
      }));
    },
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore, viewerUid],
  );

  const pauseFollowupPlanForReply = React.useCallback(
    async (input: {
      planId: string;
      leadId: string;
      reason: string;
      replyMessageId?: string;
      actorId: string;
      openFollowupIds: string[];
    }) => {
      const iso = new Date().toISOString();
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      const planPatch: Partial<FollowupPlan> = {
        status: "paused",
        pausedAt: iso,
        pausedReason: input.reason,
        replyMessageId: input.replyMessageId,
      };
      if (writeFs && orgId) {
        try {
          const db = requireWorkspaceDb();
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
          await persistTimelineEventCreate(
            db,
            orgId,
            te,
            await resolveLeadOwnerIdForFirestore(input.leadId),
          );
        } catch (e) {
            toastError("Could not pause follow-up plan", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          throw e;
        }
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
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore],
  );

  const resumeFollowupPlan = React.useCallback(
    async (input: {
      planId: string;
      leadId: string;
      openFollowupIds: string[];
      actorId?: string;
    }) => {
      const iso = new Date().toISOString();
      const actorId = input.actorId ?? viewerUid ?? "";
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      const planPatch: Partial<FollowupPlan> = {
        status: "active",
        pausedAt: undefined,
        pausedReason: undefined,
        replyMessageId: undefined,
      };
      if (writeFs && orgId) {
        try {
          const db = requireWorkspaceDb();
          await persistFollowupPlanPatch(db, input.planId, {
            status: "active",
            pausedAt: null,
            pausedReason: null,
            replyMessageId: null,
          });
          for (const fid of input.openFollowupIds) {
            await persistFollowupSetPaused(db, fid, false);
          }
          const te: TimelineEvent = {
            id: newLocalId("te"),
            leadId: input.leadId,
            type: "followup_plan_resumed",
            actorId,
            summary: "Follow-up plan resumed after email fix",
            payload: { planId: input.planId, openFollowupIds: input.openFollowupIds },
            createdAt: iso,
          };
          await persistTimelineEventCreate(
            db,
            orgId,
            te,
            await resolveLeadOwnerIdForFirestore(input.leadId),
          );
        } catch (e) {
            toastError("Could not resume follow-up plan", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          throw e;
        }
      }
      setSessionV2((s) => {
        const paused = { ...s.followups.paused };
        for (const fid of input.openFollowupIds) {
          paused[fid] = null;
        }
        const patches = {
          ...s.followupPlans.patches,
          [input.planId]: {
            ...(s.followupPlans.patches[input.planId] ?? {}),
            ...planPatch,
          },
        };
        const extras = s.followupPlans.extras.map((p) =>
          p.id === input.planId
            ? {
                ...p,
                status: "active" as const,
                pausedAt: undefined,
                pausedReason: undefined,
                replyMessageId: undefined,
              }
            : p,
        );
        const te: TimelineEvent = {
          id: newLocalId("te"),
          leadId: input.leadId,
          type: "followup_plan_resumed",
          actorId,
          summary: "Follow-up plan resumed after email fix",
          payload: { planId: input.planId, openFollowupIds: input.openFollowupIds },
          createdAt: iso,
        };
        return {
          ...s,
          followupPlans: { ...s.followupPlans, patches, extras },
          followups: { ...s.followups, paused },
          timelineAdded: mode === "live" ? s.timelineAdded : [...s.timelineAdded, te],
        };
      });
    },
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore, viewerUid],
  );

  /**
   * Replace a plan with its regenerated successor. `retireFollowupIds` are the
   * old plan's unsent steps: they are cancelled here so a replaced cadence
   * cannot keep sending, and so the list stops showing dead steps next to the
   * new ones. Cancel any linked scheduled email before calling.
   */
  const supersedeFollowupPlan = React.useCallback(
    (oldPlanId: string, newPlanId: string, retireFollowupIds: readonly string[] = []) => {
      const iso = new Date().toISOString();
      const stepPatch: Partial<Followup> = {
        deliveryStatus: "cancelled",
        cancelledAt: iso,
        cancelReason: SUPERSEDED_STEP_CANCEL_REASON,
        scheduledEmailId: undefined,
        emailScheduledAt: undefined,
      };
      const writeFs =
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistFollowupPlanSupersede(db, {
              oldPlanId,
              newPlanId,
              followupIds: retireFollowupIds,
              cancelReason: SUPERSEDED_STEP_CANCEL_REASON,
              cancelledAt: iso,
            });
          } catch (e) {
            toastError("Could not retire the prior sequence", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      }
      setSessionV2((s) => {
        const extraIds = new Set(s.followups.extras.map((f) => f.id));
        const patches = { ...s.followups.patches };
        for (const id of retireFollowupIds) {
          if (extraIds.has(id)) continue;
          patches[id] = { ...(patches[id] ?? {}), ...stepPatch };
        }
        return {
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
          followups: {
            ...s.followups,
            patches,
            extras: s.followups.extras.map((f) =>
              retireFollowupIds.includes(f.id) ? { ...f, ...stepPatch } : f,
            ),
          },
        };
      });
    },
    [mode, userDoc?.organizationId],
  );

  const setFollowupCompleted = React.useCallback(
    (id: string, completed: boolean) => {
      const snap = snapshotRef.current;
      const followup = snap.followups.find((f) => f.id === id);
      const iso = new Date().toISOString();
      const timeline: TimelineEvent | null =
        completed && followup?.leadId
          ? {
              id: newLocalId("te-local"),
              leadId: followup.leadId,
              type: "followup_completed",
              actorId: snap.currentUserId || followup.ownerId,
              summary: `Completed follow-up: ${followup.title}`,
              createdAt: iso,
              payload: { followupId: id },
            }
          : null;
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistFollowupSetCompleted(db, id, completed);
            if (timeline && followup?.leadId) {
              await persistTimelineEventCreate(
                db,
                orgId,
                timeline,
                await resolveLeadOwnerIdForFirestore(followup.leadId),
              );
            }
          } catch (e) {
            toastError("Could not update follow-up", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      }
      setSessionV2((s) => {
        const completion = { ...s.followups.completion };
        if (completed) completion[id] = iso;
        else completion[id] = null;
        return {
          ...s,
          followups: { ...s.followups, completion },
          timelineAdded: timeline ? [...s.timelineAdded, timeline] : s.timelineAdded,
        };
      });
    },
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore],
  );

  const setFollowupEmailSchedule = React.useCallback(
    (
      id: string,
      schedule:
        | {
            scheduledEmailId: string;
            emailScheduledAt: string;
            freshThread?: boolean;
            mailboxId?: string;
            fromEmail?: string;
            toEmail?: string;
            mailboxOwnerUid?: string;
          }
        | null,
    ) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistFollowupEmailSchedule(db, id, schedule);
          } catch (e) {
            toastError("Could not update email schedule", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
              [id]: schedule
                ? {
                    scheduledEmailId: schedule.scheduledEmailId,
                    emailScheduledAt: schedule.emailScheduledAt,
                    ...(schedule.mailboxId ? { mailboxId: schedule.mailboxId } : {}),
                    ...(schedule.fromEmail ? { fromEmail: schedule.fromEmail } : {}),
                    ...(schedule.toEmail ? { toEmail: schedule.toEmail } : {}),
                    ...(schedule.mailboxOwnerUid
                      ? { mailboxOwnerUid: schedule.mailboxOwnerUid }
                      : {}),
                  }
                : schedule,
            },
            patches: schedule
              ? {
                  ...s.followups.patches,
                  [id]: {
                    ...(s.followups.patches[id] ?? {}),
                    deliveryStatus: "scheduled",
                    failedAt: undefined,
                    cancelledAt: undefined,
                    deliveryError: undefined,
                    cancelReason: undefined,
                    ...(schedule.mailboxId ? { mailboxId: schedule.mailboxId } : {}),
                    ...(schedule.fromEmail ? { fromEmail: schedule.fromEmail } : {}),
                    ...(schedule.toEmail ? { toEmail: schedule.toEmail } : {}),
                    ...(schedule.mailboxOwnerUid
                      ? { mailboxOwnerUid: schedule.mailboxOwnerUid }
                      : {}),
                    ...(schedule.freshThread === true
                      ? { freshThread: true }
                      : schedule.freshThread === false
                        ? { freshThread: undefined }
                        : {}),
                  },
                }
              : s.followups.patches,
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

  const syncFollowupDelivery = React.useCallback(
    (
      id: string,
      patch: Pick<
        Followup,
        "deliveryStatus" | "sentAt" | "failedAt" | "cancelledAt" | "deliveryError" | "cancelReason"
      >,
    ) => {
      setSessionV2((s) => ({
        ...s,
        followups: {
          ...s.followups,
          patches: {
            ...s.followups.patches,
            [id]: { ...(s.followups.patches[id] ?? {}), ...patch },
          },
        },
      }));
    },
    [],
  );

  const updateFollowup = React.useCallback(
    (
      id: string,
      patch: Partial<
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
      >,
    ) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistFollowupPatch(db, id, patch);
          } catch (e) {
            toastError("Could not update follow-up", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      }
      setSessionV2((s) => {
        const inExtras = s.followups.extras.some((f) => f.id === id);
        const normalized: Partial<Followup> = { ...patch };
        if (patch.description !== undefined) {
          normalized.description = patch.description.trim() || undefined;
        }
        if (patch.messageBody !== undefined) {
          normalized.messageBody = patch.messageBody.trim() || undefined;
          normalized.hasMessageBody = undefined;
        }
        if (patch.emailSubject !== undefined) {
          normalized.emailSubject = patch.emailSubject.trim() || undefined;
        }
        if (patch.channel !== undefined && !patch.channel) {
          normalized.channel = undefined;
        }
        return {
          ...s,
          followups: {
            ...s.followups,
            extras: inExtras
              ? s.followups.extras.map((f) => (f.id === id ? { ...f, ...normalized } : f))
              : s.followups.extras,
            patches: inExtras
              ? s.followups.patches
              : {
                  ...s.followups.patches,
                  [id]: { ...(s.followups.patches[id] ?? {}), ...normalized },
                },
          },
        };
      });
    },
    [mode, userDoc?.organizationId],
  );

  const removeFollowup = React.useCallback(
    (id: string) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistFollowupDelete(db, id);
          } catch (e) {
            toastError("Could not delete follow-up", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
      const timeline: TimelineEvent | null =
        t.leadId
          ? {
              id: newLocalId("te-local"),
              leadId: t.leadId,
              type: "lead_task_created",
              actorId: t.createdById,
              summary: `Created task: ${t.title}`,
              createdAt: t.createdAt || new Date().toISOString(),
              payload: { taskId: t.id, assigneeId: t.assigneeId },
            }
          : null;
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistLeadTaskCreate(db, orgId, t);
            if (timeline && t.leadId) {
              await persistTimelineEventCreate(
                db,
                orgId,
                timeline,
                await resolveLeadOwnerIdForFirestore(t.leadId),
              );
            }
          } catch (e) {
            toastError("Could not save task", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        leadTasks: { ...s.leadTasks, extras: [...s.leadTasks.extras, t] },
        timelineAdded: timeline ? [...s.timelineAdded, timeline] : s.timelineAdded,
      }));
    },
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore],
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
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            const noteLeadOwnerId = await resolveLeadOwnerIdForFirestore(leadId);
            await persistNoteCreate(db, orgId, note, {
              leadOwnerId: noteLeadOwnerId,
            });
            await persistTimelineEventCreate(db, orgId, timeline, noteLeadOwnerId);
            await persistLeadActivityBump(db, leadId);
          } catch (e) {
            toastError("Could not save note", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore],
  );

  const updateLeadNote = React.useCallback(
    (noteId: string, patch: Partial<Pick<Note, "body" | "pinned">>) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistNoteUpdate(db, noteId, patch);
          } catch (e) {
            toastError("Could not save note", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistNoteDelete(db, noteId);
          } catch (e) {
            toastError("Could not delete note", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            const touchOwnerId = await resolveLeadOwnerIdForFirestore(t.leadId);
            await persistTouchpointCreate(db, orgId, { ...t, occurredAt: iso }, touchOwnerId);
            await persistTimelineEventCreate(db, orgId, event, touchOwnerId);
            await persistLeadActivityBump(db, t.leadId);
          } catch (e) {
            toastError("Could not save touchpoint", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore],
  );

  const addTimelineEvent = React.useCallback(
    (e: TimelineEvent) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistTimelineEventCreate(
              db,
              orgId,
              e,
              await resolveLeadOwnerIdForFirestore(e.leadId),
            );
          } catch (err) {
            toastError("Could not save timeline event", err, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "addTimelineEvent",
            });
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
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore],
  );

  const addOrgActivityEvent = React.useCallback(
    (e: OrgActivityEvent) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistOrgActivityEventCreate(db, orgId, e);
          } catch (err) {
            toastError("Could not save activity", err, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "addOrgActivityEvent",
            });
          }
        })();
      }
      setSessionV2((s) => ({
        ...s,
        orgActivityAdded: [...s.orgActivityAdded, e],
      }));
    },
    [mode, userDoc?.organizationId],
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

  const applyLeadLocalPatch = React.useCallback(
    (leadId: string, patch: Partial<Lead>) => {
      applyLeadPatchToSession(leadId, patch, new Date().toISOString());
    },
    [applyLeadPatchToSession],
  );

  const patchLeadAsync = React.useCallback(
    async (leadId: string, patch: Partial<Lead>) => {
      const viewerRole: OrgMemberRole =
        snapshotRef.current.users.find((u) => u.id === snapshotRef.current.currentUserId)?.orgRole ??
        userDoc?.orgRole ??
        "member";
      const leadFromSnap = snapshotRef.current.leads.find((l) => l.id === leadId);
      let lead = leadFromSnap ?? peekCrmEntity("leads", leadId);
      if (!lead && isWorkspaceCrmSnapshotOff() && userDoc?.organizationId) {
        const fetched = await fetchLeadByIdClient({
          leadId,
          organizationId: userDoc.organizationId,
        });
        if (fetched.status === "ok") {
          lead = fetched.lead;
          rememberCrmEntities("leads", [fetched.lead]);
          if (fetched.account) rememberCrmEntities("accounts", [fetched.account]);
          if (fetched.contact) rememberCrmEntities("contacts", [fetched.contact]);
        }
      }
      if (lead && !canEditProspectDerivedLead(lead, viewerRole)) {
        throw new Error("Only workspace admins can edit this lead.");
      }
      const scoredPatch = lead
        ? withQualityScorePatch(
            lead,
            patch,
            intentPlaybookRef.current,
            snapshotRef.current.crmLabels,
          )
        : patch;
      const iso = new Date().toISOString();
      const writeFs =
        canPersistCrmLive();
      if (writeFs) {
        const db = liveDbOrNull();
        await persistLeadPatchClient(db, leadId, scoredPatch);
      }
      applyLeadPatchToSession(leadId, scoredPatch, iso);

      const linkedSalesLeadId = lead?.linkedSalesLeadId?.trim();
      if (lead && isProspectRow(lead) && linkedSalesLeadId) {
        const salesPatch = prospectPatchForSalesLeadSync(scoredPatch);
        if (Object.keys(salesPatch).length > 0) {
          if (writeFs) {
            const db = liveDbOrNull();
            await persistLeadPatchClient(db, linkedSalesLeadId, salesPatch);
          }
          applyLeadPatchToSession(linkedSalesLeadId, salesPatch, iso);
        }
      }
      bumpDashboardKpis();
    },
    [mode, userDoc?.organizationId, userDoc?.orgRole, applyLeadPatchToSession, bumpDashboardKpis],
  );

  const patchLead = React.useCallback(
    (leadId: string, patch: Partial<Lead>) => {
      void patchLeadAsync(leadId, patch).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Only workspace admins")) {
          toastError(msg, e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "patchLead",
          });
        } else {
          toastError("Could not save lead", e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "patchLead",
          });
        }
      });
    },
    [patchLeadAsync],
  );

  const bulkReassignOwners = React.useCallback(
    async (
      items: BulkOwnerReassignItem[],
      nextOwnerId: string,
      onProgress?: (done: number, total: number) => void,
    ) => {
      if (!items.length) return;

      const viewerRole: OrgMemberRole =
        snapshotRef.current.users.find((u) => u.id === snapshotRef.current.currentUserId)?.orgRole ??
        userDoc?.orgRole ??
        "member";

      for (const item of items) {
        let lead = snapshotRef.current.leads.find((l) => l.id === item.leadId);
        if (!lead && userDoc?.organizationId) {
          const fetched = await fetchLeadByIdClient({
            leadId: item.leadId,
            organizationId: userDoc.organizationId,
          });
          if (fetched.status === "ok") lead = fetched.lead;
        }
        if (!lead) {
          throw new Error("Could not authorize one or more selected leads (not found).");
        }
        if (!canEditProspectDerivedLead(lead, viewerRole)) {
          throw new Error("Only workspace admins can edit one or more of the selected leads.");
        }
      }

      const iso = new Date().toISOString();
      const writeFs =
        canPersistCrmLive();
      const orgId = userDoc?.organizationId;

      if (writeFs && orgId) {
        const db = liveDbOrNull();
        await persistBulkOwnerReassignClient(db, orgId, items, nextOwnerId, onProgress);
      } else {
        // Demo / offline: simulate chunked progress for the UI.
        const total = items.length;
        const chunk = 25;
        for (let i = 0; i < total; i += chunk) {
          onProgress?.(Math.min(i + chunk, total), total);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      setSessionV2((s) => {
        const leadPatches = { ...s.leadPatches };
        const accountPatches = { ...s.accountPatches };
        const contactPatches = { ...s.contactPatches };
        const timelineAdded = [...s.timelineAdded];
        const leadActivity = writeFs ? s.leadActivity : { ...s.leadActivity };

        for (const item of items) {
          leadPatches[item.leadId] = {
            ...leadPatches[item.leadId],
            ...item.leadPatch,
            updatedAt: iso,
          };
          if (item.linkedSalesLeadId && item.linkedSalesPatch) {
            leadPatches[item.linkedSalesLeadId] = {
              ...leadPatches[item.linkedSalesLeadId],
              ...item.linkedSalesPatch,
              updatedAt: iso,
            };
          }
          if (item.accountId?.trim()) {
            accountPatches[item.accountId] = {
              ...accountPatches[item.accountId],
              ownerId: nextOwnerId,
              updatedAt: iso,
            };
          }
          if (item.contactId?.trim()) {
            contactPatches[item.contactId] = {
              ...contactPatches[item.contactId],
              ownerId: nextOwnerId,
              updatedAt: iso,
            };
          }
          timelineAdded.push({
            id: item.timeline.id,
            leadId: item.timeline.leadId,
            type: item.timeline.type,
            actorId: item.timeline.actorId,
            summary: item.timeline.summary,
            createdAt: item.timeline.createdAt,
          });
          if (!writeFs) {
            leadActivity[item.leadId] = {
              bump: (leadActivity[item.leadId]?.bump ?? 0) + 1,
              lastAt: item.timeline.createdAt,
            };
          }
        }

        return {
          ...s,
          leadPatches,
          accountPatches,
          contactPatches,
          timelineAdded,
          leadActivity,
        };
      });

      const actorId = snapshotRef.current.currentUserId;
      const actorName = actorLabel(snapshotRef.current.users, actorId);
      const notifyOrgId = userDoc?.organizationId || "demo";
      const notifs = items.flatMap((item) => {
        const lead = snapshotRef.current.leads.find((l) => l.id === item.leadId);
        return buildOwnershipHandoffNotifications({
          organizationId: notifyOrgId,
          actorId,
          actorName,
          previousOwnerId: item.previousOwnerId,
          nextOwnerId: nextOwnerId,
          leadId: item.leadId,
          lead: lead ?? {},
        });
      });
      void createUserNotifications(
        { organizationId: userDoc?.organizationId, isDemo: mode === "demo" },
        notifs,
      );

      onProgress?.(items.length, items.length);
      bumpDashboardKpis();
    },
    [mode, userDoc?.organizationId, userDoc?.orgRole, bumpDashboardKpis],
  );

  const patchAccount = React.useCallback(
    (accountId: string, patch: Partial<Account>) => {
      const iso = new Date().toISOString();
      const writeFs =
        canPersistCrmLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = liveDbOrNull();
            await persistAccountPatchClient(db, accountId, { ...patch, updatedAt: iso });
          } catch (e) {
            toastError("Could not save company", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistCrmLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = liveDbOrNull();
            await persistContactPatchClient(db, contactId, { ...patch, updatedAt: iso });
          } catch (e) {
            toastError("Could not save contact", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistCrmLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = liveDbOrNull();
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
            toastError("Could not save deal", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
      const canLiveWrite = mode === "live" && Boolean(viewerUid) && Boolean(userDoc?.organizationId);
      if (canLiveWrite) {
        void (async () => {
          try {
            const orgId = await resolveOrganizationIdForFirestoreWrite(userDoc?.organizationId);
            if (!orgId) {
              toastError(
                "Could not save label",
                new Error(
                  "No organization id on your session. Try refreshing the page or signing out and back in.",
                ),
                {
                  location: "src/components/providers/workspace-mode-provider.tsx",
                  functionName: "addCrmLabel",
                },
              );
              return;
            }
            const db = requireWorkspaceDb();
            await persistCrmLabelCreate(db, orgId, label);
          } catch (e) {
            toastError("Could not save label", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
        return;
      }
      setLabelDelta((d) => ({ ...d, added: [...d.added, label] }));
    },
    [mode, viewerUid, userDoc?.organizationId],
  );

  const updateCrmLabel = React.useCallback(
    (id: string, patch: Partial<Pick<CrmLabel, "name" | "color">>) => {
      const writeFs =
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistCrmLabelUpdate(db, id, patch);
          } catch (e) {
            toastError("Could not update label", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
        canPersistWorkspaceDocsLive();
      if (writeFs) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistCrmLabelDelete(db, id);
          } catch (e) {
            toastError("Could not delete label", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
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
    async (
      leadId: string,
      options?: { quiet?: boolean; skipActivity?: boolean },
    ): Promise<boolean> => {
      const quiet = options?.quiet === true;
      const skipActivity = options?.skipActivity === true;
      const snap = snapshotRef.current;
      const role = snap.users.find((u) => u.id === snap.currentUserId)?.orgRole ?? "member";
      if (!roleAtLeast(role, "manager")) {
        if (!quiet) {
          toast.error("Only organization owners, admins, and managers can delete leads.");
        }
        return false;
      }
      let lead = snap.leads.find((l) => l.id === leadId) ?? peekCrmEntity("leads", leadId);
      if (!lead && isWorkspaceCrmSnapshotOff() && userDoc?.organizationId) {
        const fetched = await fetchLeadByIdClient({
          leadId,
          organizationId: userDoc.organizationId,
        });
        if (fetched.status === "ok") {
          lead = fetched.lead;
          rememberCrmEntities("leads", [fetched.lead]);
          if (fetched.account) rememberCrmEntities("accounts", [fetched.account]);
        }
      }
      if (!lead) return false;
      let account =
        snap.accounts.find((a) => a.id === lead.accountId) ?? peekCrmEntity("accounts", lead.accountId);
      if (!account && isWorkspaceCrmSnapshotOff() && lead.accountId) {
        const fetchedAccount = await fetchAccountByIdClient(lead.accountId);
        if (fetchedAccount.status === "ok") {
          account = fetchedAccount.entity;
          rememberCrmEntities("accounts", [fetchedAccount.entity]);
        }
      }
      if (!account) {
        if (!quiet) {
          toast.error("Could not delete lead: account not found.");
        }
        return false;
      }

      const recordDeletedActivity = () => {
        if (skipActivity || !snap.currentUserId) return;
        emitBulkLeadOrgActivity(addOrgActivityEvent, {
          type: "leads_deleted",
          actorId: snap.currentUserId,
          count: 1,
          leadId,
          leadLabel: leadDisplayLabel(lead),
        });
      };

      const writeFs =
        canPersistCrmLive();
      if (writeFs) {
        try {
          const db = liveDbOrNull();
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
          recordDeletedActivity();
          return true;
        } catch (e) {
          if (!quiet) {
            toastError("Could not delete lead", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "deleteLead",
            });
          }
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
      recordDeletedActivity();
      bumpDashboardKpis();
      return true;
    },
    [mode, userDoc?.organizationId, addOrgActivityEvent, bumpDashboardKpis],
  );

  const archiveLead = React.useCallback(
    async (
      leadId: string,
      options?: { reason?: LeadArchiveReason; quiet?: boolean; skipActivity?: boolean },
    ): Promise<boolean> => {
      const quiet = options?.quiet === true;
      const skipActivity = options?.skipActivity === true;
      const snap = snapshotRef.current;
      const viewerRole: OrgMemberRole =
        snap.users.find((u) => u.id === snap.currentUserId)?.orgRole ?? userDoc?.orgRole ?? "member";
      const lead = await leadRowForMutation(leadId, userDoc?.organizationId, snap.leads);
      if (!lead) return false;
      if (!canEditProspectDerivedLead(lead, viewerRole)) {
        if (!quiet) toast.error("Only workspace admins can archive this lead.");
        return false;
      }
      if (isLeadArchived(lead)) {
        if (!quiet) toast.info("Already archived");
        return true;
      }
      const actorId = snap.currentUserId;
      if (!actorId) {
        if (!quiet) toast.error("Sign in to archive leads.");
        return false;
      }
      const patch = buildArchivePatch({
        actorId,
        reason: options?.reason ?? "manual",
      });
      try {
        await patchLeadAsync(leadId, patch);
      } catch (e) {
        if (!quiet) {
          toastError("Could not archive lead", e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "archiveLead",
          });
        }
        return false;
      }
      if (!skipActivity) {
        emitBulkLeadOrgActivity(addOrgActivityEvent, {
          type: "leads_archived",
          actorId,
          count: 1,
          leadId,
          leadLabel: leadDisplayLabel(lead),
        });
      }
      if (!quiet) toast.success("Moved to archive");
      bumpDashboardKpis();
      return true;
    },
    [userDoc?.orgRole, patchLeadAsync, addOrgActivityEvent, bumpDashboardKpis],
  );

  const restoreLead = React.useCallback(
    async (
      leadId: string,
      options?: { asProspect?: boolean; quiet?: boolean; skipActivity?: boolean },
    ): Promise<boolean> => {
      const quiet = options?.quiet === true;
      const skipActivity = options?.skipActivity === true;
      const snap = snapshotRef.current;
      const viewerRole: OrgMemberRole =
        snap.users.find((u) => u.id === snap.currentUserId)?.orgRole ?? userDoc?.orgRole ?? "member";
      const lead = await leadRowForMutation(leadId, userDoc?.organizationId, snap.leads);
      if (!lead) return false;
      if (!canEditProspectDerivedLead(lead, viewerRole)) {
        if (!quiet) toast.error("Only workspace admins can restore this lead.");
        return false;
      }
      if (!isLeadArchived(lead)) {
        if (!quiet) toast.info("Not archived");
        return true;
      }
      const actorId = snap.currentUserId;
      if (!actorId) {
        if (!quiet) toast.error("Sign in to restore leads.");
        return false;
      }
      const asProspect = options?.asProspect === true;
      const patch = asProspect ? buildRestoreAsProspectPatch() : buildRestorePatch();
      try {
        await patchLeadAsync(leadId, patch);
      } catch (e) {
        if (!quiet) {
          toastError("Could not restore lead", e, {
            location: "src/components/providers/workspace-mode-provider.tsx",
            functionName: "restoreLead",
          });
        }
        return false;
      }
      if (!skipActivity) {
        emitBulkLeadOrgActivity(addOrgActivityEvent, {
          type: "leads_restored",
          actorId,
          count: 1,
          leadId,
          leadLabel: leadDisplayLabel(lead),
        });
      }
      if (!quiet) {
        toast.success(asProspect ? "Restored to Prospects" : "Restored from archive");
      }
      bumpDashboardKpis();
      return true;
    },
    [userDoc?.orgRole, patchLeadAsync, addOrgActivityEvent, bumpDashboardKpis],
  );

  const updateLeadStage = React.useCallback(
    (leadId: string, nextStage: PipelineStage, previousStage: PipelineStage, actorId: string) => {
      const snap = snapshotRef.current;
      const viewerRole: OrgMemberRole =
        snap.users.find((u) => u.id === snap.currentUserId)?.orgRole ?? userDoc?.orgRole ?? "member";
      const lead =
        snap.leads.find((l) => l.id === leadId) ?? peekCrmEntity("leads", leadId);
      if (lead && !canEditProspectDerivedLead(lead, viewerRole)) {
        toast.error("Only workspace admins can edit this lead.");
        return;
      }

      const iso = new Date().toISOString();
      const shouldArchiveLost =
        nextStage === "lost" && previousStage !== "lost" && lead && !isLeadArchived(lead);
      const archivePatch = shouldArchiveLost
        ? buildArchivePatch({ actorId, reason: "lost", now: iso })
        : null;
      const ev: TimelineEvent = {
        id: newLocalId("te-local"),
        leadId,
        type: "stage_changed",
        actorId,
        summary: `Moved from ${STAGES_BY_KEY[previousStage].label} → ${STAGES_BY_KEY[nextStage].label}`,
        createdAt: iso,
      };
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      const linkedSalesLeadId = lead?.linkedSalesLeadId?.trim();
      const syncSalesLeadStage = Boolean(lead && isProspectRow(lead) && linkedSalesLeadId);

      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            const stagePayload: Record<string, unknown> = {
              stage: nextStage,
              ...(archivePatch ?? {}),
            };
            await updateDoc(doc(db, COLLECTIONS.leads, leadId), stagePayload);
            await persistTimelineEventCreate(
              db,
              orgId,
              ev,
              await resolveLeadOwnerIdForFirestore(leadId),
            );
            if (syncSalesLeadStage && linkedSalesLeadId) {
              await updateDoc(doc(db, COLLECTIONS.leads, linkedSalesLeadId), {
                stage: nextStage,
                ...(archivePatch ?? {}),
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
            toastError("Could not save stage", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      }
      setSessionV2((s) => {
        const leadPatches = {
          ...s.leadPatches,
          [leadId]: {
            ...s.leadPatches[leadId],
            stage: nextStage,
            ...(archivePatch ?? {}),
          },
        };
        if (syncSalesLeadStage && linkedSalesLeadId) {
          leadPatches[linkedSalesLeadId] = {
            ...s.leadPatches[linkedSalesLeadId],
            stage: nextStage,
            ...(archivePatch ?? {}),
          };
        }
        return {
          ...s,
          leadPatches,
          timelineAdded: [...s.timelineAdded, ev],
        };
      });
    },
    [mode, userDoc?.organizationId, userDoc?.orgRole, resolveLeadOwnerIdForFirestore],
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
    const uid = viewerUid ?? "";
    /** Firestore query uses `organizationId`; if the member doc is missing that field, the roster is empty but leads still store `ownerId` as Firebase uid - merge the viewer so UserChip and owner pickers resolve. */
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
      orgActivityEvents: liveFs.orgActivityEvents,
      profiles: liveFs.profiles,
      campaigns: liveFs.campaigns,
      crmLabels: liveFs.crmLabels,
      departments: liveFs.departments,
      permissionOverrides: liveFs.permissionOverrides,
      currentUserId: uid,
    };
    if (!uid || !userDoc) {
      return { ...raw, users: liveFs.users };
    }
    const viewer: User = { ...userDoc, id: uid };
    const roster =
      liveFs.users.length === 0
        ? [viewer]
        : liveFs.users.map((u) => {
            if (u.id !== uid) return u;
            const rosterEmail = u.email?.trim().toLowerCase();
            const sessionEmail = userDoc.email?.trim().toLowerCase();
            const emailMismatch =
              Boolean(rosterEmail) &&
              Boolean(sessionEmail) &&
              rosterEmail !== sessionEmail;
            // Stale Clerk→Nova uid bridge: roster row is a different person.
            // Prefer the signed-in session identity until the bridge is repaired.
            if (emailMismatch) {
              return viewer;
            }
            return {
              ...u,
              displayName: userDoc.displayName?.trim() || u.displayName,
              email: userDoc.email?.trim() || u.email,
              orgRole: userDoc.orgRole ?? u.orgRole,
              photoURL: userDoc.photoURL ?? u.photoURL,
            };
          });
    const rosterHasViewer = roster.some((u) => u.id === uid);
    const fullRoster = rosterHasViewer ? roster : [...roster, viewer];
    return applyLiveHierarchyScope(raw, viewer, fullRoster, {
      snapshotCutoverActive: isWorkspaceCrmSnapshotOff(),
    });
  }, [
    mode,
    demoSnapshot,
    demoPersonaId,
    fbUser?.uid,
    viewerUid,
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
    liveFs.orgActivityEvents,
    liveFs.profiles,
    liveFs.campaigns,
    liveFs.crmLabels,
    liveFs.departments,
    liveFs.permissionOverrides,
  ]);

  const preSessionSnapshot = React.useMemo((): WorkspaceSnapshot => {
    const removed = new Set(poDelta.removedIds);
    const permissionOverrides = [
      ...tenantBaseSnapshot.permissionOverrides.filter((p) => !removed.has(p.id)),
      ...poDelta.added.filter(
        (p) =>
          !removed.has(p.id) &&
          !tenantBaseSnapshot.permissionOverrides.some((existing) => existing.id === p.id),
      ),
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
    const nextUsers = tenantBaseSnapshot.users.map((u) => {
      const patch = userPatches[u.id];
      return patch ? { ...u, ...patch } : u;
    });
    const prevUsers = stableUsersMergedRef.current;
    const usersMerged =
      prevUsers.length === nextUsers.length &&
      prevUsers.every((u, i) => u === nextUsers[i])
        ? prevUsers
        : nextUsers;
    stableUsersMergedRef.current = usersMerged;

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
      departments: (() => {
        const liveIds = new Set(tenantBaseSnapshot.departments.map((d) => d.id));
        const extras = addedDepartments.filter((d) => !liveIds.has(d.id));
        return [...tenantBaseSnapshot.departments, ...extras].map((d) => {
          const patch = departmentPatches[d.id];
          return patch ? { ...d, ...patch } : d;
        });
      })(),
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
    departmentPatches,
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
    const merged = mergeSessionIntoSnapshot(
      withCachedSessionTargets(preSessionSnapshot, sessionV2),
      sessionV2,
      { keepUnloadedLeadLinks: isLiveCrmSnapshotDisabled(mode === "demo") },
    );
    const planPatches = sessionV2.followupPlans.patches;
    const followupPlans = mergeFollowupPlans(merged.followupPlans ?? [], merged.followups).map(
      (p) => (planPatches[p.id] ? { ...p, ...planPatches[p.id] } : p),
    );
    return { ...preSessionSnapshot, ...merged, followupPlans };
  }, [preSessionSnapshot, sessionV2, mode]);

  snapshotRef.current = snapshot;

  const setLeadTaskCompleted = React.useCallback(
    (id: string, completed: boolean) => {
      const snap = snapshotRef.current;
      const task = snap.leadTasks.find((t) => t.id === id);
      const iso = new Date().toISOString();
      const timeline: TimelineEvent | null =
        completed && task?.leadId
          ? {
              id: newLocalId("te-local"),
              leadId: task.leadId,
              type: "lead_task_completed",
              actorId: snap.currentUserId || task.assigneeId,
              summary: `Completed task: ${task.title}`,
              createdAt: iso,
              payload: { taskId: id },
            }
          : null;
      const writeFs =
        canPersistWorkspaceDocsLive();
      const orgId = userDoc?.organizationId;
      if (writeFs && orgId) {
        void (async () => {
          try {
            const db = requireWorkspaceDb();
            await persistLeadTaskSetCompleted(db, id, completed);
            if (timeline && task?.leadId) {
              await persistTimelineEventCreate(
                db,
                orgId,
                timeline,
                await resolveLeadOwnerIdForFirestore(task.leadId),
              );
            }
            if (completed) {
              await persistUserNotificationDismiss(db, `lt-inbox-${id}`).catch(() => {
                /* row may not exist for pre-fanout tasks */
              });
            }
          } catch (e) {
            toastError("Could not update task", e, {
              location: "src/components/providers/workspace-mode-provider.tsx",
              functionName: "workspacePersist",
            });
          }
        })();
      } else if (completed && mode === "demo") {
        useDemoUserNotifications.getState().dismiss(`lt-inbox-${id}`);
      }
      setSessionV2((s) => {
        const completion = { ...s.leadTasks.completion };
        if (completed) completion[id] = iso;
        else completion[id] = null;
        return {
          ...s,
          leadTasks: { ...s.leadTasks, completion },
          timelineAdded: timeline ? [...s.timelineAdded, timeline] : s.timelineAdded,
        };
      });
    },
    [mode, userDoc?.organizationId, resolveLeadOwnerIdForFirestore],
  );

  const value = React.useMemo<WorkspaceContextValue>(() => {
    const snapshotWithIdle = { ...snapshot, leads: enrichLeadsIdleState(snapshot.leads) };
    const lookup = createWorkspaceLookup(snapshotWithIdle);
    const getLeadById = (id: string) => lookup.getLeadById(id) ?? peekCrmEntity("leads", id);
    const getContactById = (id: string) =>
      lookup.getContactById(id) ?? peekCrmEntity("contacts", id);
    const getAccountById = (id: string) =>
      lookup.getAccountById(id) ?? peekCrmEntity("accounts", id);
    const getOwnerDisplayName = (uid: string): string | undefined => {
      const id = uid?.trim();
      if (!id) return undefined;
      const fromUser = snapshotWithIdle.users.find((u) => u.id === id)?.displayName?.trim();
      if (fromUser) return fromUser;
      return orgMemberLabels[id]?.trim() || undefined;
    };
    const viewerRole: OrgMemberRole =
      snapshotWithIdle.users.find((u) => u.id === snapshotWithIdle.currentUserId)?.orgRole ?? "member";
    const viewer =
      snapshotWithIdle.users.find((u) => u.id === snapshotWithIdle.currentUserId) ??
      (userDoc && viewerUid ? ({ ...userDoc, id: viewerUid } as User) : undefined);
    /** Permanent lead delete — org owner / admin / manager only (matches Firestore rules). */
    const canDeleteLeads = roleAtLeast(viewerRole, "manager");
    const canEditLead = (lead: Lead) => canEditProspectDerivedLead(lead, viewerRole);
    const reportIds = viewer
      ? collectDescendantUserIds(viewer.id, snapshotWithIdle.users)
      : new Set<string>();
    const canViewMemberMailboxes =
      roleAtLeast(viewerRole, "admin") ||
      canAction(viewer, "mailbox.view_others") ||
      reportIds.size > 0 ||
      delegatedMailboxHostIds.length > 0;
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
      getLeadById,
      getContactById,
      getAccountById,
      mode,
      isDemo: mode === "demo",
      demoPersonaId,
      organizationId: liveOrgId,
      organizationName,
      organizationTimezone,
      organizationSendPolicy,
      intentPlaybook,
      setIntentPlaybook,
      liveFirestoreError:
        mode === "live"
          ? !identityLoading &&
              !viewerUid &&
              firebaseLive &&
              !isAuthDisabled()
            ? new Error(
                "Firebase Auth session is missing in this browser tab. Sign out and sign in again to load live CRM data.",
              )
            : liveFs.error
          : null,
      userProfileError:
        mode === "live" && viewerUid
          ? (firebaseLive ? userProfileLoadError : sessionProfile.error) ?? null
          : null,
      workspaceLoading:
        mode === "live"
          ? identityLoading ||
            (Boolean(viewerUid) &&
              (firebaseLive ? userDocLoading : sessionProfile.loading)) ||
            (Boolean(liveOrgId) && liveFs.loading)
          : demoSnapshot == null,
      followupsReady:
        mode === "demo" ? demoSnapshot != null : liveFs.coreReady.followups,
      setMode,
      setDemoPersona,
      addPermissionOverride,
      removePermissionOverride,
      addDepartment,
      updateDepartment,
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
      syncFollowupDelivery,
      removeFollowup,
      updateFollowup,
      pauseFollowupPlanForReply,
      resumeFollowupPlan,
      supersedeFollowupPlan,
      addLeadTask,
      setLeadTaskCompleted,
      addLeadNote,
      updateLeadNote,
      deleteLeadNote,
      addLeadTouchpoint,
      addTimelineEvent,
      addOrgActivityEvent,
      patchLead,
      patchLeadAsync,
      applyLeadLocalPatch,
      bulkReassignOwners,
      patchAccount,
      patchContact,
      patchDeal,
      addCrmLabel,
      updateCrmLabel,
      removeCrmLabel,
      deleteLead,
      archiveLead,
      restoreLead,
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
      activeOrgMemberIds,
      requestWorkspaceGroups,
    };
  }, [
    snapshot,
    orgMemberLabels,
    activeOrgMemberIds,
    delegatedMailboxHostIds,
    mode,
    demoPersonaId,
    liveOrgId,
    organizationName,
    organizationTimezone,
    organizationSendPolicy,
    intentPlaybook,
    setIntentPlaybook,
    liveFs.error,
    liveFs.loading,
    liveFs.coreReady.followups,
    demoSnapshot,
    userProfileLoadError,
    sessionProfile.error,
    sessionProfile.loading,
    identityLoading,
    viewerUid,
    firebaseLive,
    userDocLoading,
    userDoc,
    setMode,
    setDemoPersona,
    addPermissionOverride,
    removePermissionOverride,
    addDepartment,
    updateDepartment,
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
    syncFollowupDelivery,
    removeFollowup,
    updateFollowup,
    pauseFollowupPlanForReply,
    resumeFollowupPlan,
    supersedeFollowupPlan,
    addLeadTask,
    setLeadTaskCompleted,
    addLeadNote,
    updateLeadNote,
    deleteLeadNote,
    addLeadTouchpoint,
    addTimelineEvent,
    addOrgActivityEvent,
    patchLead,
    patchLeadAsync,
    applyLeadLocalPatch,
    bulkReassignOwners,
    patchAccount,
    patchContact,
    patchDeal,
    addCrmLabel,
    updateCrmLabel,
    removeCrmLabel,
    deleteLead,
    archiveLead,
    restoreLead,
    updateLeadStage,
    toggleLeadPin,
    isLeadPinned,
    bumpLeadActivity,
    requestWorkspaceGroups,
    requestedGroupsKey,
    crmCacheEpoch,
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
