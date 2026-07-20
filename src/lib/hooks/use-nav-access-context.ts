"use client";

import { mockUsers } from "@/lib/mock-data";
import type { NavAccessContext } from "@/lib/nav";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isAuthDisabled } from "@/lib/auth/flags";
import { useComputedPermissions } from "@/lib/hooks/use-computed-permissions";
import { useUserDoc } from "@/lib/hooks/use-user-doc";

export function useNavAccessContext(): NavAccessContext {
  const { user: fbUser } = useAuth();
  const { isDemo, demoPersonaId } = useWorkspace();
  const useMockPersona = isDemo || isAuthDisabled() || !fbUser;
  const mockUser =
    mockUsers.find((u) => u.id === demoPersonaId) ?? mockUsers[0]!;
  const uid = useMockPersona || !fbUser ? undefined : fbUser.uid;
  const { data: userDoc, loading: userDocLoading } = useUserDoc(uid);
  const { data: roleSnapshot, loading: permsLoading } = useComputedPermissions(uid);

  const profileReady = useMockPersona || userDoc != null || !userDocLoading;
  const permsReady = useMockPersona || !profileReady || !permsLoading;

  return {
    roleId: useMockPersona ? mockUser.roleId : userDoc?.roleId,
    orgRole: useMockPersona ? mockUser.orgRole : userDoc?.orgRole,
    isSuperAdmin: !useMockPersona && Boolean(userDoc?.isSuperAdmin),
    featureGrants: useMockPersona ? mockUser.featureGrants : userDoc?.featureGrants,
    roleSnapshot: useMockPersona ? null : roleSnapshot,
    roleLoading: !useMockPersona && (!profileReady || !permsReady),
  };
}
