"use client";

import * as React from "react";
import { doc, onSnapshot, type Unsubscribe } from "@/lib/db/document-shim/shim-client-firestore";
import { getClientDb } from "@/lib/db/document-access/client";
import { COLLECTIONS } from "@/lib/documents/collections";
import { documentTimestampToIso } from "@/lib/documents/timestamp-util";
import { normalizeFeatureGrants } from "@/lib/admin-feature-access";
import type { Role, User } from "@/lib/types";

function asUser(id: string, raw: Record<string, unknown>): User {
  return {
    id,
    email: String(raw.email ?? ""),
    displayName: String(raw.displayName ?? raw.email ?? id),
    photoURL: typeof raw.photoURL === "string" ? raw.photoURL : undefined,
    roleId: (raw.roleId as Role) ?? "salesperson",
    departmentId: typeof raw.departmentId === "string" ? raw.departmentId : undefined,
    managerId: typeof raw.managerId === "string" ? raw.managerId : undefined,
    managerAncestorIds: Array.isArray(raw.managerAncestorIds)
      ? raw.managerAncestorIds.filter((x): x is string => typeof x === "string")
      : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    isSuperAdmin: Boolean(raw.isSuperAdmin),
    company: typeof raw.company === "string" ? raw.company : undefined,
    organizationId: typeof raw.organizationId === "string" ? raw.organizationId : undefined,
    orgRole: raw.orgRole as User["orgRole"],
    featureGrants: normalizeFeatureGrants(raw.featureGrants),
    status: (raw.status as User["status"]) ?? "active",
    createdAt: documentTimestampToIso(raw.createdAt),
  };
}

/**
 * Live `users/{uid}` profile via the Postgres document shim.
 * Prefer workspace roster / session profile when available; this hook remains for
 * callers that need a direct doc subscription.
 */
export function useUserDoc(uid: string | undefined) {
  const [data, setData] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(Boolean(uid));
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!uid) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let unsub: Unsubscribe | undefined;
    setLoading(true);
    try {
      const db = getClientDb();
      const ref = doc(db, COLLECTIONS.users, uid);
      unsub = onSnapshot(
        ref,
        (snap) => {
          setData(snap.exists() ? asUser(snap.id, snap.data() as Record<string, unknown>) : null);
          setLoading(false);
          setError(null);
        },
        (e) => {
          setError(e);
          setLoading(false);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }

    return () => unsub?.();
  }, [uid]);

  return { data, loading, error };
}
