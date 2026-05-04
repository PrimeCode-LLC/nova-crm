"use client";

import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { mergeChannelAdminConfig } from "@/lib/channel-admin-defaults";
import type { OrganizationChannelAdminConfig } from "@/lib/types";
import {
  getChannelAdminPersistedSnapshot,
  useChannelAdminStore,
} from "@/stores/channel-admin-store";
import { roleAtLeast } from "@/lib/platform/org-role";

/**
 * Loads workspace channel admin config from Firestore (org.channelAdmin) and
 * keeps the zustand store in sync. Admins: debounced PUT on local edits.
 * Members: read-only hydration from GET.
 */
export function ChannelAdminSync() {
  const { user } = useAuth();
  const { mode } = useWorkspace();
  const { data: userDoc } = useUserDoc(
    mode === "demo" || isAuthDisabled() || !user ? undefined : user.uid,
  );

  const orgId = userDoc?.organizationId;
  const canEdit =
    userDoc?.orgRole !== undefined && roleAtLeast(userDoc.orgRole, "admin");

  const [hydrated, setHydrated] = React.useState(false);
  const lastSentJson = React.useRef<string>("");

  React.useEffect(() => {
    if (isAuthDisabled() || !isFirebaseWebConfigured() || mode === "demo") {
      setHydrated(true);
      return;
    }
    if (!orgId) {
      setHydrated(false);
      return;
    }

    let cancelled = false;
    setHydrated(false);

    void fetch("/api/org/channel-admin", { credentials: "include", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { channelAdmin?: OrganizationChannelAdminConfig | null } | null) => {
        if (cancelled || !data) {
          if (!cancelled) setHydrated(true);
          return;
        }
        const merged = mergeChannelAdminConfig(data.channelAdmin ?? undefined);
        const prev = useChannelAdminStore.getState();
        /** Org has no Firestore payload yet — keep browser-local custom channels once, then PUT migrates them. */
        const customChannels =
          data.channelAdmin != null
            ? merged.customChannels
            : prev.customChannels.length > 0
              ? prev.customChannels
              : merged.customChannels;

        useChannelAdminStore.setState({
          autoMap: merged.autoMap,
          descriptionOverrides: merged.descriptionOverrides,
          customChannels,
        });
        lastSentJson.current = JSON.stringify(
          getChannelAdminPersistedSnapshot(useChannelAdminStore.getState()),
        );
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, mode]);

  React.useEffect(() => {
    if (
      isAuthDisabled() ||
      !isFirebaseWebConfigured() ||
      mode === "demo" ||
      !orgId ||
      !hydrated ||
      !canEdit
    ) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const unsub = useChannelAdminStore.subscribe((state) => {
      const snapshot = getChannelAdminPersistedSnapshot(state);
      const json = JSON.stringify(snapshot);
      if (json === lastSentJson.current) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        if (json === lastSentJson.current) return;
        void fetch("/api/org/channel-admin", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: json,
        })
          .then((res) => {
            if (res.ok) lastSentJson.current = json;
          })
          .catch(() => {});
      }, 900);
    });

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [orgId, hydrated, canEdit, mode]);

  return null;
}
