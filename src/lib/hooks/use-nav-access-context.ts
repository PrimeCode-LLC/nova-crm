"use client";

import { mockUsers } from "@/lib/mock-data";
import type { NavAccessContext } from "@/lib/nav";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isAuthDisabled } from "@/lib/auth/flags";
import { useComputedPermissions } from "@/lib/hooks/use-computed-permissions";

/**
 * Nav access from the live workspace roster / demo persona.
 * Do not key off Firebase Auth — Clerk + Postgres deploys leave `useAuth().user` null.
 */
export function useNavAccessContext(): NavAccessContext {
  const { isDemo, demoPersonaId, currentUserId, getUserById, users } = useWorkspace();
  const useMockPersona = isDemo || isAuthDisabled();
  const mockUser =
    mockUsers.find((u) => u.id === demoPersonaId) ??
    users.find((u) => u.id === demoPersonaId) ??
    users[0] ??
    mockUsers[0]!;
  const liveUser = useMockPersona ? null : getUserById(currentUserId) ?? null;
  const uid = useMockPersona ? undefined : currentUserId || undefined;
  const { data: roleSnapshot, loading: permsLoading } = useComputedPermissions(uid);

  const profileReady = useMockPersona || liveUser != null || Boolean(currentUserId);
  const permsReady = useMockPersona || !profileReady || !permsLoading;

  return {
    roleId: useMockPersona ? mockUser.roleId : liveUser?.roleId,
    orgRole: useMockPersona ? mockUser.orgRole : liveUser?.orgRole,
    isSuperAdmin: !useMockPersona && Boolean(liveUser?.isSuperAdmin),
    featureGrants: useMockPersona ? mockUser.featureGrants : liveUser?.featureGrants,
    roleSnapshot: useMockPersona ? null : roleSnapshot,
    roleLoading: !useMockPersona && (!profileReady || !permsReady),
  };
}
