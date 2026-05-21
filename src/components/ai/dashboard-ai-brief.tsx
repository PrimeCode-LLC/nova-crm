"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ChannelKey } from "@/lib/types";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { DASHBOARD_BRIEF_CACHE_DAYS } from "@/lib/ai/dashboard-brief-cache";

type BriefResult = {
  progress: string;
  risks: string[];
  suggestions: string[];
  watchList: { title: string; reason: string; href: string | null }[];
  cached?: boolean;
  cachedAt?: string;
};

export function DashboardAiBrief({
  channelScope,
  ownerScope,
  timeRange,
  ownerLabel,
  enabled,
  demoBundle,
}: {
  channelScope: ChannelKey[];
  ownerScope: string;
  timeRange: DashboardTimeRangeKey;
  ownerLabel: string;
  enabled: boolean;
  demoBundle?: {
    leads: unknown[];
    deals: unknown[];
    followups: unknown[];
    leadTasks: unknown[];
    users: unknown[];
  };
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState<BriefResult | null>(null);

  const filterKey = React.useMemo(
    () =>
      JSON.stringify({
        channelScope,
        ownerScope,
        timeRange,
        demo: Boolean(demoBundle),
      }),
    [channelScope, ownerScope, timeRange, demoBundle],
  );

  const fetchGenerationRef = React.useRef(0);
  const loadedFilterKeyRef = React.useRef<string | null>(null);

  const fetchBrief = React.useCallback(
    async (regenerate = false, requestFilterKey = filterKey) => {
      if (!enabled) return;
      const generation = ++fetchGenerationRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/ai/dashboard-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelScope,
            ownerScope,
            timeRange,
            regenerate,
            demoBundle,
          }),
        });
        const data = await res.json();
        if (generation !== fetchGenerationRef.current) return;
        if (!res.ok) {
          const msg = typeof data.error === "string" ? data.error : "Could not generate overview";
          if (res.status === 403) {
            setError(
              msg.includes("not enabled")
                ? `${msg} Turn on Platform AI in Admin → AI & knowledge, add a provider key, then Regenerate.`
                : msg,
            );
          } else {
            setError(msg);
          }
          return;
        }
        if (requestFilterKey !== filterKey) return;
        setBrief(data as BriefResult);
      } catch {
        if (generation !== fetchGenerationRef.current) return;
        setError("Network error");
      } finally {
        if (generation === fetchGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [channelScope, ownerScope, timeRange, enabled, demoBundle, filterKey],
  );

  React.useEffect(() => {
    if (!enabled) return;
    if (loadedFilterKeyRef.current === filterKey) return;
    loadedFilterKeyRef.current = filterKey;
    setBrief(null);
    void fetchBrief(false, filterKey);
  }, [enabled, filterKey, fetchBrief]);

  if (!enabled) return null;

  return (
    <Card className="shrink-0 overflow-visible border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              AI overview
            </CardTitle>
            <CardDescription className="text-xs mt-1 leading-relaxed">
              {ownerLabel} · Last {timeRange.replace("d", " days").replace("qtd", "quarter").replace("ytd", "year")}
              {channelScope.length > 0 ? ` · ${channelScope.length} channel(s)` : ""}
              {brief?.cachedAt && (
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {brief.cached
                    ? `cached ${new Date(brief.cachedAt).toLocaleString()} · auto-refreshes every ${DASHBOARD_BRIEF_CACHE_DAYS} days`
                    : `generated ${new Date(brief.cachedAt).toLocaleString()}`}
                </span>
              )}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void fetchBrief(true, filterKey)}
            className="shrink-0 gap-1.5"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Regenerate
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pb-5 text-sm leading-relaxed">
        {error && (
          <div className="flex items-start gap-2 text-destructive text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {loading && !brief && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Analyzing pipeline and follow-ups…
          </p>
        )}
        {brief && (
          <div className="space-y-5">
            <section className="rounded-lg border border-border/60 bg-background/40 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Progress</h3>
              <p className="text-sm leading-relaxed text-foreground">{brief.progress}</p>
            </section>
            {(brief.risks.length > 0 || brief.suggestions.length > 0) && (
              <div className="grid gap-4 md:grid-cols-2">
                {brief.risks.length > 0 && (
                  <section className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 min-w-0">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-destructive mb-2">Risks</h3>
                    <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed marker:text-destructive/60">
                      {brief.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {brief.suggestions.length > 0 && (
                  <section className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 min-w-0">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Suggestions</h3>
                    <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed marker:text-primary/60">
                      {brief.suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
            {brief.watchList.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Watch list</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {brief.watchList.map((w, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border/80 bg-muted/20 px-3 py-2.5 text-sm min-w-0"
                    >
                      <p className="font-medium leading-snug">{w.title}</p>
                      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{w.reason}</p>
                      {w.href && (
                        <Link href={w.href} className="text-primary mt-2 inline-block text-xs hover:underline">
                          Open
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {!loading && !error && !brief && (
          <p className="text-xs text-muted-foreground">
            Enable Platform AI and save at least one API key in{" "}
            <Link href="/admin/ai" className="text-primary hover:underline">
              Admin → AI & knowledge
            </Link>
            , then use Regenerate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
