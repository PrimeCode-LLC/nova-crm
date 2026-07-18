"use client";

import * as React from "react";
import {
  buildDemoMailboxUtilization,
  summarizeMailboxUtilization,
  type MailboxUtilizationRow,
  type MailboxUtilizationSummary,
} from "@/lib/email/mailbox-utilization";
import { useEmailAccountStore } from "@/stores/email-account-store";

type State = {
  rows: MailboxUtilizationRow[];
  summary: MailboxUtilizationSummary | null;
  loading: boolean;
  error: string | null;
};

export function useMailboxUtilization(opts: {
  enabled: boolean;
  isDemo: boolean;
  currentUserId: string;
}) {
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const sent = useEmailAccountStore((s) => s.sent);
  const scheduled = useEmailAccountStore((s) => s.scheduled);

  const [state, setState] = React.useState<State>({
    rows: [],
    summary: null,
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
    });
  }, [opts.isDemo, opts.enabled, opts.currentUserId, mailboxes, sent, scheduled]);

  React.useEffect(() => {
    if (!opts.enabled) {
      setState({ rows: [], summary: null, loading: false, error: null });
      return;
    }

    if (opts.isDemo) {
      setState({
        rows: demoRows,
        summary: summarizeMailboxUtilization(demoRows),
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
          rows?: MailboxUtilizationRow[];
          summary?: MailboxUtilizationSummary;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok || !data.rows) {
          setState({
            rows: [],
            summary: null,
            loading: false,
            error: data.error ?? "Could not load inbox utilization",
          });
          return;
        }
        setState({
          rows: data.rows,
          summary: data.summary ?? summarizeMailboxUtilization(data.rows),
          loading: false,
          error: null,
        });
      } catch {
        if (cancelled) return;
        setState({
          rows: [],
          summary: null,
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
