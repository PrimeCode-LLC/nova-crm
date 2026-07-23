"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { readAppClaims } from "@/lib/auth/claims";
import { refreshServerSessionFromCurrentUser } from "@/lib/auth/client-session";

/**
 * When an admin changes this user's org role (or related claims), Firestore
 * updates immediately but the httpOnly session cookie can stay stale. Re-exchange
 * the session when the user profile and ID-token claims diverge.
 */
export function AuthSessionSync() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: userDoc } = useUserDoc(user?.uid);
  const syncingRef = React.useRef(false);
  const lastSyncedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (isAuthDisabled() || !isFirebaseWebConfigured() || !user) return;

    const docOrgId = userDoc?.organizationId;
    const docOrgRole = userDoc?.orgRole;
    if (!docOrgId && !docOrgRole) return;

    const sig = `${docOrgId ?? ""}|${docOrgRole ?? ""}`;
    if (lastSyncedRef.current === sig) return;

    let cancelled = false;

    void (async () => {
      if (syncingRef.current) return;
      try {
        const token = await user.getIdTokenResult(false);
        const claims = readAppClaims(token.claims as Record<string, unknown>);
        const orgMismatch =
          Boolean(docOrgId) && Boolean(claims.organizationId) && claims.organizationId !== docOrgId;
        const roleMismatch =
          Boolean(docOrgRole) && Boolean(claims.orgRole) && claims.orgRole !== docOrgRole;

        if (!orgMismatch && !roleMismatch) {
          lastSyncedRef.current = sig;
          return;
        }

        syncingRef.current = true;
        await refreshServerSessionFromCurrentUser(user);
        if (!cancelled) {
          lastSyncedRef.current = sig;
          router.refresh();
        }
      } catch {
        /* non-fatal - user can still sign out/in */
      } finally {
        syncingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, userDoc?.organizationId, userDoc?.orgRole, router]);

  return null;
}
