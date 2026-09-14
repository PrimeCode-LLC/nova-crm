"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, FlaskConical, ShieldAlert, GitBranch } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CreateVariantDialog } from "@/components/admin/outreach-lab/create-variant-dialog";
import { PromoteSheet } from "@/components/admin/outreach-lab/promote-sheet";
import { DatasetPanel } from "@/components/admin/outreach-lab/dataset-panel";
import { ExperimentsTab } from "@/components/admin/outreach-lab/experiments-tab";
import { ReviewQueue } from "@/components/admin/outreach-lab/review-queue";

type Scorecard = {
  delivered?: number;
  positiveReplyRate?: number;
  engagedReplyRate?: number;
  meanPotentialScore?: number;
  acceptanceRate?: number;
  bounceRate?: number;
  maturityPct?: number;
  offlinePassRate?: number | null;
  judgeWinRate?: number | null;
  confoundWarnings?: string[];
};

type ConfigRow = {
  id: string;
  label: string;
  status: string;
  featureKey: string;
  provider: string;
  model: string;
  systemPrompt: string;
  userPromptTemplate: string;
  parentConfigId?: string | null;
  createdAt: string;
  scorecard?: Scorecard | null;
  zones?: Array<"lab" | "canary" | "default">;
};

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(100 * n).toFixed(1)}%`;
}

export function OutreachLabClient() {
  const [loading, setLoading] = React.useState(true);
  const [configs, setConfigs] = React.useState<ConfigRow[]>([]);
  const [projection, setProjection] = React.useState<{
    requiredLeads?: number;
    mailboxesForHorizon?: number;
    requiredEmails?: number;
  } | null>(null);
  const [breaker, setBreaker] = React.useState<{
    orgPaused?: boolean;
    reason?: string;
  } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [forkParent, setForkParent] = React.useState<ConfigRow | null>(null);
  const [promote, setPromote] = React.useState<{
    config: ConfigRow;
    toZone: "canary" | "default";
  } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, brRes] = await Promise.all([
        fetch("/api/ai/outreach-configs?featureKey=followup_suggest"),
        fetch("/api/outreach/circuit-breaker"),
      ]);
      const cfgData = await cfgRes.json();
      if (cfgRes.ok) {
        setConfigs(cfgData.configs ?? []);
        setProjection(cfgData.projection ?? null);
      } else {
        toast.error(
          typeof cfgData.error === "string" ? cfgData.error : "Failed to load configs",
        );
      }
      if (brRes.ok) {
        const br = await brRes.json();
        setBreaker(br.state ?? null);
      }
    } catch {
      toast.error("Failed to load Outreach Lab");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function runEval(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/ai/outreach-configs/${id}/eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Eval failed");
        return;
      }
      toast.success(data.queued ? "Eval queued on worker" : "Eval completed");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function clearBreaker() {
    const res = await fetch("/api/outreach/circuit-breaker", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(typeof data.error === "string" ? data.error : "Forbidden");
      return;
    }
    toast.success("Circuit breaker cleared");
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Outreach Lab…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Outreach Lab
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Evaluate prompt/config variants offline, promote through lab → canary → default,
            and watch reply-quality scorecards. Lab generations never send mail.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {breaker?.orgPaused && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-4 w-4" /> Circuit breaker open
            </CardTitle>
            <CardDescription>{breaker.reason ?? "Sending paused"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="destructive" onClick={() => void clearBreaker()}>
              Clear breaker
            </Button>
          </CardContent>
        </Card>
      )}

      {projection && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Projection (1 deal / 30 days)</CardTitle>
            <CardDescription>
              ~{projection.requiredLeads} leads · ~{projection.requiredEmails} emails · ~
              {projection.mailboxesForHorizon} mailboxes
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Tabs defaultValue="configs">
        <TabsList>
          <TabsTrigger value="configs">Configs</TabsTrigger>
          <TabsTrigger value="dataset">Dataset</TabsTrigger>
          <TabsTrigger value="experiments">Experiments</TabsTrigger>
          <TabsTrigger value="review">Review queue</TabsTrigger>
        </TabsList>

        <TabsContent value="configs" className="mt-4 space-y-4">
          {configs.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                No configs loaded. Click Refresh to seed a default.
              </p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Seed / refresh
              </Button>
            </div>
          )}
          {configs.map((c) => {
            const sc = c.scorecard;
            return (
              <Card key={c.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">
                      <Link
                        href={`/admin/outreach-lab/${c.id}`}
                        className="hover:underline"
                      >
                        {c.label}
                      </Link>
                    </CardTitle>
                    <div className="flex flex-wrap gap-1">
                      {(c.zones ?? []).map((z) => (
                        <Badge key={z}>{z}</Badge>
                      ))}
                      <Badge variant="secondary">{c.status}</Badge>
                    </div>
                  </div>
                  <CardDescription className="font-mono text-xs">
                    {c.id} · {c.provider}/{c.model}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Delivered</div>
                      <div className="font-medium">{sc?.delivered ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Positive reply</div>
                      <div className="font-medium">{pct(sc?.positiveReplyRate)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Maturity</div>
                      <div className="font-medium">{pct(sc?.maturityPct)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Offline pass</div>
                      <div className="font-medium">
                        {pct(sc?.offlinePassRate ?? undefined)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Judge win</div>
                      <div className="font-medium">
                        {pct(sc?.judgeWinRate ?? undefined)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Bounce</div>
                      <div className="font-medium">{pct(sc?.bounceRate)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Acceptance</div>
                      <div className="font-medium">{pct(sc?.acceptanceRate)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Engaged reply</div>
                      <div className="font-medium">{pct(sc?.engagedReplyRate)}</div>
                    </div>
                  </div>
                  {sc?.confoundWarnings && sc.confoundWarnings.length > 0 && (
                    <p className="text-xs text-amber-600">
                      {sc.confoundWarnings.join(" · ")}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/outreach-lab/${c.id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      Open
                    </Link>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === c.id}
                      onClick={() => void runEval(c.id)}
                    >
                      Run eval
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setForkParent(c)}
                    >
                      <GitBranch className="mr-1 h-3.5 w-3.5" />
                      Create variant
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPromote({ config: c, toZone: "canary" })}
                    >
                      Promote → canary
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setPromote({ config: c, toZone: "default" })}
                    >
                      Promote → default
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="dataset" className="mt-4">
          <DatasetPanel />
        </TabsContent>

        <TabsContent value="experiments" className="mt-4">
          <ExperimentsTab
            configs={configs.map((c) => ({ id: c.id, label: c.label }))}
          />
        </TabsContent>

        <TabsContent value="review" className="mt-4">
          <ReviewQueue />
        </TabsContent>
      </Tabs>

      <CreateVariantDialog
        open={!!forkParent}
        onOpenChange={(o) => {
          if (!o) setForkParent(null);
        }}
        parent={forkParent}
        onCreated={() => void load()}
      />

      {promote && (
        <PromoteSheet
          open={!!promote}
          onOpenChange={(o) => {
            if (!o) setPromote(null);
          }}
          configId={promote.config.id}
          configLabel={promote.config.label}
          toZone={promote.toZone}
          onPromoted={() => void load()}
        />
      )}
    </div>
  );
}
