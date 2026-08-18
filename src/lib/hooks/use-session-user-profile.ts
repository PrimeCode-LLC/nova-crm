"use client";

import * as React from "react";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import type { OrgMemberRole, User } from "@/lib/types";

type MeResponse = {
  user: {
    uid: string;
    email?: string;
    name?: string;
    organizationId?: string;
    orgRole?: OrgMemberRole;
  } | null;
  membershipPending?: boolean;
};

function toUser(u: NonNullable<MeResponse["user"]>): User {
  return {
    id: u.uid,
    email: u.email ?? "",
    displayName: u.name ?? u.email?.split("@")[0] ?? u.uid,
    roleId: "salesperson",
    organizationId: u.organizationId,
    orgRole: u.orgRole,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Hydrates a minimal Nova user profile from `/api/auth/me` when Firestore
 * `users/{uid}` is unavailable (Firebase-disabled / Clerk + Postgres deploy).
 */
export function useSessionUserProfile(enabled: boolean) {
  const [data, setData] = React.useState<User | null>(null);
  const [uid, setUid] = React.useState<string | undefined>(undefined);
  const [loading, setLoading] = React.useState(enabled);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      setData(null);
      setUid(undefined);
      setLoading(false);
      return;
    }

    if (isAuthDisabled()) {
      setUid("dev");
      setData(
        toUser({
          uid: "dev",
          email: "dev@local",
          name: "Dev user",
          organizationId: "dev-org",
          orgRole: "owner",
        }),
      );
      setLoading(false);
      return;
    }

    if (!isClerkAuthV1Enabled()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as MeResponse;
        if (cancelled) return;
        if (!res.ok || !json.user) {
          setData(null);
          setUid(undefined);
          setLoading(false);
          return;
        }
        setUid(json.user.uid);
        setData(toUser(json.user));
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, uid, loading, error };
}
