"use client";

import * as React from "react";
import { doc, onSnapshot, type Unsubscribe } from "@/lib/db/document-shim/shim-client-firestore";
import { getClientDb } from "@/lib/db/document-access/client";
import { isClientDocumentSyncEnabled } from "@/lib/db/document-access/config";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { EffectivePermissionSnapshot } from "@/lib/permissions/role-types";
import { parseComputedPermissionsDoc } from "@/lib/permissions/computed-permissions";

/**
 * Live `computedPermissions/{uid}` for the signed-in user.
 * Resolves to null when the doc is missing or uses a legacy shape.
 */
export function useComputedPermissions(uid: string | undefined): {
  data: EffectivePermissionSnapshot | null;
  loading: boolean;
} {
  const [data, setData] = React.useState<EffectivePermissionSnapshot | null>(null);
  const [loading, setLoading] = React.useState(Boolean(uid));

  React.useEffect(() => {
    if (!uid || !isClientDocumentSyncEnabled()) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    let unsub: Unsubscribe | undefined;
    try {
      const db = getClientDb();
      const ref = doc(db, COLLECTIONS.computedPermissions, uid);
      unsub = onSnapshot(
        ref,
        (snap) => {
          setData(
            snap.exists()
              ? parseComputedPermissionsDoc(snap.data() as Record<string, unknown>)
              : null,
          );
          setLoading(false);
        },
        () => {
          setData(null);
          setLoading(false);
        },
      );
    } catch {
      setData(null);
      setLoading(false);
    }

    return () => unsub?.();
  }, [uid]);

  return { data, loading };
}
