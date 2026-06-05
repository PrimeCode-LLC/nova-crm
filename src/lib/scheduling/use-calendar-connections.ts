"use client";

import * as React from "react";
import type { CalendarConnection } from "@/lib/types";

export type CalendarOauthConfig = {
  google: boolean;
  microsoft: boolean;
  googleMethod?: "firebase" | "oauth" | "none";
};

type CacheEntry = {
  connections: CalendarConnection[];
  oauth: CalendarOauthConfig;
};

const DEFAULT_OAUTH: CalendarOauthConfig = {
  google: false,
  microsoft: false,
  googleMethod: "none",
};

const cache = new Map<string, CacheEntry>();

function cacheKey(isDemo: boolean, userId?: string): string {
  return isDemo ? "demo" : userId?.trim() || "anon";
}

export function seedCalendarConnectionsCache(
  isDemo: boolean,
  userId: string | undefined,
  connections: CalendarConnection[],
  oauth?: Partial<CalendarOauthConfig>,
): void {
  cache.set(cacheKey(isDemo, userId), {
    connections,
    oauth: { ...DEFAULT_OAUTH, ...oauth },
  });
}

export function useCalendarConnections(isDemo: boolean, userId?: string) {
  const key = cacheKey(isDemo, userId);
  const cached = cache.get(key);

  const [connections, setConnections] = React.useState<CalendarConnection[]>(
    cached?.connections ?? [],
  );
  const [oauth, setOauth] = React.useState<CalendarOauthConfig>(cached?.oauth ?? DEFAULT_OAUTH);
  const [loading, setLoading] = React.useState(!cached);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(
    async (opts?: { background?: boolean }) => {
      if (isDemo) {
        const demoConnections: CalendarConnection[] = [
          {
            id: "demo-google",
            organizationId: "demo-org",
            ownerUid: "demo",
            provider: "google",
            accountEmail: "you@gmail.com",
            checkCalendarLabel: "Primary calendar",
            writeCalendarLabel: "Primary calendar",
            includeBuffers: true,
            syncExternalChanges: false,
            status: "connected",
            lastSyncAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
        const demoOauth: CalendarOauthConfig = {
          google: true,
          microsoft: false,
          googleMethod: "firebase",
        };
        cache.set(key, { connections: demoConnections, oauth: demoOauth });
        setConnections(demoConnections);
        setOauth(demoOauth);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const hasCache = cache.has(key);
      if (!opts?.background && !hasCache) {
        setLoading(true);
      } else if (hasCache) {
        setRefreshing(true);
      }

      try {
        const [connRes, ctxRes] = await Promise.all([
          fetch("/api/scheduling/calendar-connections"),
          fetch("/api/scheduling/context"),
        ]);
        const [cj, ctx] = await Promise.all([connRes.json(), ctxRes.json()]);
        const nextConnections = cj.ok ? ((cj.items ?? []) as CalendarConnection[]) : [];
        const nextOauth = ctx.ok
          ? ({ ...DEFAULT_OAUTH, ...(ctx.oauth ?? {}) } as CalendarOauthConfig)
          : DEFAULT_OAUTH;
        cache.set(key, { connections: nextConnections, oauth: nextOauth });
        if (cj.ok) setConnections(nextConnections);
        if (ctx.ok) setOauth(nextOauth);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isDemo, key],
  );

  React.useEffect(() => {
    void load({ background: Boolean(cache.get(key)) });
  }, [load, key]);

  const patchConnection = React.useCallback(
    (id: string, patch: Partial<CalendarConnection>) => {
      setConnections((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
        const entry = cache.get(key);
        if (entry) cache.set(key, { ...entry, connections: next });
        return next;
      });
    },
    [key],
  );

  const removeConnection = React.useCallback(
    (id: string) => {
      setConnections((prev) => {
        const next = prev.filter((c) => c.id !== id);
        const entry = cache.get(key);
        if (entry) cache.set(key, { ...entry, connections: next });
        return next;
      });
    },
    [key],
  );

  return {
    connections,
    oauth,
    loading,
    refreshing,
    load,
    patchConnection,
    removeConnection,
    setConnections,
  };
}
