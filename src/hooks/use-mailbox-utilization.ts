"use client";

import * as React from "react";
import {
  buildDemoMailboxUtilization,
  summarizeMailboxUtilization,
  type MailboxUtilizationRow,
  type MailboxUtilizationSummary,
} from "@/lib/email/mailbox-utilization";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { useEmailAccountStore } from "@/stores/email-account-store";

export type MailboxUtilizationScope = "org" | "mine";

type State = {
  rows: MailboxUtilizationRow[];
  summary: MailboxUtilizationSummary | null;
  scope: MailboxUtilizationScope;
  loading: boolean;
  error: string | null;
};

type CachedUtilization = {
  fetchedAt: number;
  rows: MailboxUtilizationRow[];
  summary: MailboxUtilizationSummary;
  scope: MailboxUtilizationScope;
};

const UTILIZATION_STALE_MS = 60_000;
let utilizationCache: CachedUtilization | null = null;
let utilizationInflight: Promise<CachedUtilization | { error: string }> | null = null;

async function fetchUtilizationShared(): Promise<CachedUtilization | { error: string }> {
  if (
    utilizationCache &&
    Date.now() - utilizationCache.fetchedAt < UTILIZATION_STALE_MS
  ) {
    return utilizationCache;
  }
  if (utilizationInflight) return utilizationInflight;

  utilizationInflight = (async () => {
    try {
      const res = await fetch("/api/email/mailboxes/utilization");
      const data = (await res.json()) as {
        ok?: boolean;
        scope?: MailboxUtilizationScope;
        rows?: MailboxUtilizationRow[];
        summary?: MailboxUtilizationSummary;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.rows) {
        return { error: data.error ?? "Could not load inbox utilization" };
      }
      const cached: CachedUtilization = {
        fetchedAt: Date.now(),
        rows: data.rows,
        summary: data.summary ?? summarizeMailboxUtilization(data.rows),
        scope: data.scope === "mine" ? "mine" : "org",
      };
      utilizationCache = cached;
      return cached;
    } catch {
      return { error: "Could not reach the server" };
    } finally {
      utilizationInflight = null;
    }
  })();

  return utilizationInflight;
}

export function useMailboxUtilization(opts: {
  enabled: boolean;
  isDemo: boolean;
  currentUserId: string;
  /**
   * Delay the utilization fetch so dashboard core Firestore (followups/leads)
   * and chart cards can connect first. Utilization is often 60–100s and saturates
   * the same backend path.
   */
  deferMs?: number;
}) {
  const timeZone = useOrgTimezone();
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const sent = useEmailAccountStore((s) => s.sent);
  const scheduled = useEmailAccountStore((s) => s.scheduled);

  const [state, setState] = React.useState<State>(() => {
    if (
      utilizationCache &&
      Date.now() - utilizationCache.fetchedAt < UTILIZATION_STALE_MS
    ) {
      return {
        rows: utilizationCache.rows,
        summary: utilizationCache.summary,
        scope: utilizationCache.scope,
        loading: false,
        error: null,
      };
    }
    return {
      rows: [],
      summary: null,
      scope: "org",
      loading: false,
      error: null,
    };
  });

  const demoRows = React.useMemo(() => {
    if (!opts.isDemo || !opts.enabled) return [];
    return buildDemoMailboxUtilization({
      mailboxes,
      sent,
      scheduled,
      currentUserId: opts.currentUserId,
      timeZone,
    });
  }, [opts.isDemo, opts.enabled, opts.currentUserId, mailboxes, sent, scheduled, timeZone]);

  React.useEffect(() => {
    if (!opts.enabled) {
      setState({ rows: [], summary: null, scope: "org", loading: false, error: null });
      return;
    }

    if (opts.isDemo) {
      setState({
        rows: demoRows,
        summary: summarizeMailboxUtilization(demoRows),
        scope: "mine",
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    const deferMs = opts.deferMs ?? 0;
    const hasFreshCache =
      utilizationCache && Date.now() - utilizationCache.fetchedAt < UTILIZATION_STALE_MS;
    if (!hasFreshCache) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }

    const run = async () => {
      const result = await fetchUtilizationShared();
      if (cancelled) return;
      if ("error" in result) {
        setState({
          rows: [],
          summary: null,
          scope: "org",
          loading: false,
          error: result.error,
        });
        return;
      }
      setState({
        rows: result.rows,
        summary: result.summary,
        scope: result.scope,
        loading: false,
        error: null,
      });
    };

    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (hasFreshCache) {
      // Still refresh in background after defer, but UI already has data.
      if (deferMs <= 0) {
        void run();
      } else {
        timeoutId = setTimeout(() => {
          if (!cancelled) void run();
        }, deferMs);
      }
    } else if (deferMs <= 0) {
      void run();
    } else if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      timeoutId = setTimeout(() => {
        idleId = window.requestIdleCallback(
          () => {
            if (!cancelled) void run();
          },
          { timeout: 4_000 },
        );
      }, deferMs);
    } else {
      timeoutId = setTimeout(() => {
        if (!cancelled) void run();
      }, deferMs);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (idleId !== undefined && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [opts.enabled, opts.isDemo, opts.deferMs, demoRows]);

  return state;
}
