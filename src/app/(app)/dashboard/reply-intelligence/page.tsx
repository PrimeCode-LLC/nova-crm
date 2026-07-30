"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { ReplyIntelligenceDashboard } from "@/components/dashboard/reply-intelligence-dashboard";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  REPLY_ANALYTICS_RANGE_LABELS,
  type ReplyAnalyticsRangeKey,
  type ReplyIntelligenceAnalytics,
} from "@/lib/email/reply-action-analytics";
import { REPLY_CLASS_LABELS, type ReplyClass } from "@/lib/email/reply-action-types";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";

const RANGE_KEYS: ReplyAnalyticsRangeKey[] = ["7d", "30d", "90d", "all"];
const RANGE_OPTIONS = RANGE_KEYS.map((key) => ({
  key,
  label: REPLY_ANALYTICS_RANGE_LABELS[key],
}));
const CLASS_FILTERS: Array<"all" | ReplyClass> = [
  "all",
  "auto_reply",
  "positive",
  "meeting_ready",
  "neutral",
  "objection",
  "soft_no",
  "hard_no",
  "unclear",
];
const STATUS_FILTERS = ["all", "pending", "sent", "accepted", "dismissed", "expired"] as const;

export default function ReplyIntelligencePage() {
  const [range, setRange] = React.useState<ReplyAnalyticsRangeKey>("30d");
  const [classification, setClassification] = React.useState<string>("all");
  const [status, setStatus] = React.useState<string>("all");
  const [loading, setLoading] = React.useState(true);
  const [analytics, setAnalytics] = React.useState<ReplyIntelligenceAnalytics | null>(null);
  const [memberLabels, setMemberLabels] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [rowCount, setRowCount] = React.useState(0);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        range,
        classification,
        status,
      });
      const response = await fetch(`/api/email/reply-actions/analytics?${params}`, {
        credentials: "same-origin",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        analytics?: ReplyIntelligenceAnalytics;
        memberLabels?: Record<string, string>;
        rowCount?: number;
      };
      if (!response.ok || !data.ok || !data.analytics) {
        throw new Error(data.error || "Could not load analytics");
      }
      setAnalytics(data.analytics);
      setMemberLabels(data.memberLabels ?? {});
      setRowCount(data.rowCount ?? 0);
    } catch (e) {
      setAnalytics(null);
      setError(e instanceof Error ? e.message : "Could not load analytics");
    } finally {
      setLoading(false);
    }
  }, [classification, range, status]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppPage>
      <PageHeader
        title="Reply intelligence"
        description="Classification mix, approval rates, and win outcomes from AI reply actions — fuel for future strategy packs."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            value={range}
            onValueChange={(v) => setRange((v ?? "30d") as ReplyAnalyticsRangeKey)}
          >
            <SelectTrigger className="h-8 w-[150px]" size="sm">
              <SelectValue>
                {selectTriggerLabelByKey(range, RANGE_OPTIONS) ?? undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(({ key, label }) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={classification} onValueChange={(v) => setClassification(v ?? "all")}>
            <SelectTrigger className="h-8 w-[160px]" size="sm">
              <SelectValue>
                {classification === "all"
                  ? "All classes"
                  : REPLY_CLASS_LABELS[classification as ReplyClass] ?? classification}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CLASS_FILTERS.map((key) => (
                <SelectItem key={key} value={key}>
                  {key === "all" ? "All classes" : REPLY_CLASS_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
            <SelectTrigger className="h-8 w-[140px]" size="sm">
              <SelectValue>
                {status === "all" ? "All statuses" : status}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((key) => (
                <SelectItem key={key} value={key}>
                  {key === "all" ? "All statuses" : key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!loading ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {rowCount} action{rowCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </PageHeader>

      <PageBody className="space-y-4 p-6">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <ReplyIntelligenceDashboard
          analytics={analytics}
          memberLabels={memberLabels}
          loading={loading}
        />
      </PageBody>
    </AppPage>
  );
}
