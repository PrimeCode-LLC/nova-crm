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

export function useMailboxUtilization(opts: {
  enabled: boolean;
  isDemo: boolean;
  currentUserId: string;
}) {
  const timeZone = useOrgTimezone();
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const sent = useEmailAccountStore((s) => s.sent);
  const scheduled = useEmailAccountStore((s) => s.scheduled);

  const [state, setState] = React.useState<State>({
    rows: [],
    summary: null,
    scope: "org",
    loading: false,
    error: null,
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
    setState((s) => ({ ...s, loading: true, error: null }));

    void (async () => {
      try {
        const res = await fetch("/api/email/mailboxes/utilization");
        const data = (await res.json()) as {
          ok?: boolean;
          scope?: MailboxUtilizationScope;
          rows?: MailboxUtilizationRow[];
          summary?: MailboxUtilizationSummary;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok || !data.rows) {
          setState({
            rows: [],
            summary: null,
            scope: "org",
            loading: false,
            error: data.error ?? "Could not load inbox utilization",
          });
          return;
        }
        setState({
          rows: data.rows,
          summary: data.summary ?? summarizeMailboxUtilization(data.rows),
          scope: data.scope === "mine" ? "mine" : "org",
          loading: false,
          error: null,
        });
      } catch {
        if (cancelled) return;
        setState({
          rows: [],
          summary: null,
          scope: "org",
          loading: false,
          error: "Could not reach the server",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [opts.enabled, opts.isDemo, demoRows]);

  return state;
}
