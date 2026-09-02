"use client";

import * as React from "react";
import { doc, onSnapshot, type Unsubscribe } from "@/lib/db/document-shim/shim-client-firestore";
import { getClientDb } from "@/lib/db/document-access/client";
import { isClientDocumentSyncEnabled } from "@/lib/db/document-access/config";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { User } from "@/lib/types";

export function useUserDoc(uid: string | undefined) {
  const [data, setData] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!uid || !isClientDocumentSyncEnabled()) {
      setData(null);
      setLoading(false);
      return;
    }

    let unsub: Unsubscribe | undefined;
    try {
      const db = getClientDb();
      const ref = doc(db, COLLECTIONS.users, uid);
      unsub = onSnapshot(
        ref,
        (snap) => {
          setData(snap.exists() ? (snap.data() as unknown as User) : null);
          setLoading(false);
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
