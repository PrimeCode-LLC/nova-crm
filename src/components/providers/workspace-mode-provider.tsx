"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceMode } from "@/lib/workspace-mode";
import type { Account, Campaign, Contact, Department, PermissionOverride, Profile } from "@/lib/types";
import {
  getWorkspaceSnapshot,
  createWorkspaceLookup,
  type WorkspaceSnapshot,
  type WorkspaceLookup,
} from "@/lib/workspace-dataset";
import { setWorkspaceModeCookie } from "@/app/(app)/actions/workspace-mode";
import { setDemoPersonaCookie } from "@/app/(app)/actions/demo-persona";

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
  };

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

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
  const [accountContactBumps, setAccountContactBumps] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    setPoDelta({ added: [], removedIds: [] });
    setAddedDepartments([]);
    setProfileDelta({ updates: {}, added: [] });
    setCampaignEdits({});
    setCampaignsAdded([]);
    setAccountsAdded([]);
    setContactsAdded([]);
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

  const snapshot = React.useMemo((): WorkspaceSnapshot => {
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
    return {
      ...baseSnapshot,
      permissionOverrides,
      departments: [...baseSnapshot.departments, ...addedDepartments],
      profiles,
      campaigns,
      accounts: accountsMerged,
      contacts: contactsMerged,
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
    accountContactBumps,
  ]);

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
