"use client";

import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { mergeChannelAdminConfig } from "@/lib/channel-admin-defaults";
import type { ChannelKey, OrganizationChannelAdminConfig } from "@/lib/types";
import {
  getChannelAdminPersistedSnapshot,
  useChannelAdminStore,
} from "@/stores/channel-admin-store";
import { roleAtLeast } from "@/lib/platform/org-role";

/**
 * Loads workspace channel admin config from Firestore (org.channelAdmin) and
 * keeps the zustand store in sync. Debounced PUT on local edits: admins sync
 * the full snapshot; members sync custom channels only (built-ins stay
 * server-controlled on the wire).
 */
export function ChannelAdminSync() {
  const { user } = useAuth();
  const { mode } = useWorkspace();
  const { data: userDoc } = useUserDoc(
    mode === "demo" || isAuthDisabled() || !user ? undefined : user.uid,
  );

  const orgId = userDoc?.organizationId;
  const orgRole = userDoc?.orgRole;
  const isAdmin = orgRole !== undefined && roleAtLeast(orgRole, "admin");

  const [hydrated, setHydrated] = React.useState(false);
  const lastSentJson = React.useRef<string>("");
  const lastSentCustomJson = React.useRef<string>("");
  const hydratedBuiltins = React.useRef<{
    autoMap: Record<ChannelKey, boolean>;
    descriptionOverrides: Partial<Record<ChannelKey, string>>;
  } | null>(null);

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
        hydratedBuiltins.current = {
          autoMap: merged.autoMap,
          descriptionOverrides: merged.descriptionOverrides,
        };
        const snap = getChannelAdminPersistedSnapshot(useChannelAdminStore.getState());
        lastSentJson.current = JSON.stringify(snap);
        lastSentCustomJson.current = JSON.stringify(snap.customChannels);
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
      orgRole === undefined
    ) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const unsub = useChannelAdminStore.subscribe((state) => {
      const snapshot = getChannelAdminPersistedSnapshot(state);

      if (isAdmin) {
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
        return;
      }

      const customJson = JSON.stringify(snapshot.customChannels);
      if (customJson === lastSentCustomJson.current) return;
      if (!hydratedBuiltins.current) return;

      const body = JSON.stringify({
        autoMap: hydratedBuiltins.current.autoMap,
        descriptionOverrides: hydratedBuiltins.current.descriptionOverrides,
        customChannels: snapshot.customChannels,
      });

      clearTimeout(timer);
      timer = setTimeout(() => {
        if (customJson === lastSentCustomJson.current) return;
        void fetch("/api/org/channel-admin", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body,
        })
          .then((res) => {
            if (res.ok) {
              lastSentCustomJson.current = customJson;
              lastSentJson.current = JSON.stringify(getChannelAdminPersistedSnapshot(useChannelAdminStore.getState()));
            }
          })
          .catch(() => {});
      }, 900);
    });

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [orgId, hydrated, isAdmin, orgRole, mode]);

  return null;
}
