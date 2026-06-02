"use client";

import { mockUsers } from "@/lib/mock-data";
import type { NavAccessContext } from "@/lib/nav";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isAuthDisabled } from "@/lib/auth/flags";
import { useUserDoc } from "@/lib/hooks/use-user-doc";

export function useNavAccessContext(): NavAccessContext {
  const { user: fbUser } = useAuth();
  const { isDemo, demoPersonaId } = useWorkspace();
  const useMockPersona = isDemo || isAuthDisabled() || !fbUser;
  const mockUser =
    mockUsers.find((u) => u.id === demoPersonaId) ?? mockUsers[0]!;
  const { data: userDoc, loading: userDocLoading } = useUserDoc(
    useMockPersona || !fbUser ? undefined : fbUser.uid,
  );

  return {
    roleId: useMockPersona ? mockUser.roleId : userDoc?.roleId,
    orgRole: useMockPersona ? mockUser.orgRole : userDoc?.orgRole,
    isSuperAdmin: !useMockPersona && Boolean(userDoc?.isSuperAdmin),
    featureGrants: useMockPersona ? mockUser.featureGrants : userDoc?.featureGrants,
    roleLoading: !useMockPersona && userDocLoading && userDoc == null,
  };
}
