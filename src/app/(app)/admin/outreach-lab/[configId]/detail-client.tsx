"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { CreateVariantDialog } from "@/components/admin/outreach-lab/create-variant-dialog";
import { PromoteSheet } from "@/components/admin/outreach-lab/promote-sheet";
import { ConfigDiff } from "@/components/admin/outreach-lab/config-diff";
import { EvalRunsTable } from "@/components/admin/outreach-lab/eval-runs-table";

type DetailPayload = {
  config: {
    id: string;
    label: string;
    status: string;
    featureKey: string;
    provider: string;
    model: string;
    systemPrompt: string;
    userPromptTemplate: string;
    parentConfigId: string | null;
    notes: string | null;
    createdAt: string;
  };
  scorecard: Record<string, unknown> | null;
  lineage: Array<{ id: string; label: string; parentConfigId: string | null; createdAt: string }>;
  evalRuns: Array<Record<string, unknown>>;
  zones: Array<"lab" | "canary" | "default">;
  sampleGenerations: Array<{
    id: string;
    zone: string;
    status: string;
    accepted: boolean | null;
    createdAt: string;
    output: unknown;
  }>;
};

function pct(n: unknown): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${(100 * n).toFixed(1)}%`;
}

function num(n: unknown): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return String(n);
}

export function OutreachLabDetailClient() {
  const params = useParams();
  const configId = String(params.configId ?? "");
  const [data, setData] = React.useState<DetailPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [forkOpen, setForkOpen] = React.useState(false);
  const [promoteZone, setPromoteZone] = React.useState<"canary" | "default" | null>(null);
  const [diffParent, setDiffParent] = React.useState<{
    systemPrompt: string;
    userPromptTemplate: string;
    label: string;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!configId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/outreach-configs/${configId}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Not found");
        setData(null);
        return;
      }
      setData(json);
      if (json.lineage?.[1]) {
        const parentId = json.lineage[1].id as string;
        const parentRes = await fetch(`/api/ai/outreach-configs/${parentId}`);
        if (parentRes.ok) {
          const parentJson = await parentRes.json();
          setDiffParent({
            systemPrompt: parentJson.config.systemPrompt,
            userPromptTemplate: parentJson.config.userPromptTemplate,
            label: parentJson.config.label,
          });
        }
      } else {
        setDiffParent(null);
      }
    } finally {
      setLoading(false);
    }
  }, [configId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function runEval() {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/outreach-configs/${configId}/eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync: false }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Eval failed");
        return;
      }
      toast.success(json.queued ? "Eval queued" : "Eval completed");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Config" />
        <PageBody>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading config…
          </div>
        </PageBody>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Config" description="Config not found." />
        <PageBody>
          <Link href="/admin/outreach-lab" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Back
          </Link>
        </PageBody>
      </>
    );
  }

  const { config, scorecard, lineage, evalRuns, zones, sampleGenerations } = data;
  const sc = scorecard ?? {};

  return (
    <>
      <PageHeader
        title={config.label}
        description={`${config.id} · ${config.provider}/${config.model}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runEval()}>
              Run eval
            </Button>
            <Button size="sm" variant="outline" onClick={() => setForkOpen(true)}>
              Create variant
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPromoteZone("canary")}>
              → canary
            </Button>
            <Button size="sm" onClick={() => setPromoteZone("default")}>
              → default
            </Button>
          </div>
        }
      >
        <Link
          href="/admin/outreach-lab"
          className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Outreach Lab
        </Link>
        <div className="mt-2 flex flex-wrap gap-1">
          {zones.map((z) => (
            <Badge key={z}>{z}</Badge>
          ))}
          <Badge variant="secondary">{config.status}</Badge>
        </div>
      </PageHeader>
      <PageBody>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Scorecard</CardTitle>
            <CardDescription>Precomputed — refresh via worker / after eval</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Delivered</div>
              <div className="font-medium">{num(sc.delivered)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Maturity</div>
              <div className="font-medium">{pct(sc.maturityPct)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Positive reply</div>
              <div className="font-medium">{pct(sc.positiveReplyRate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Engaged reply</div>
              <div className="font-medium">{pct(sc.engagedReplyRate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Offline pass</div>
              <div className="font-medium">{pct(sc.offlinePassRate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Judge win (display)</div>
              <div className="font-medium">{pct(sc.judgeWinRate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Bounce</div>
              <div className="font-medium">{pct(sc.bounceRate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Acceptance</div>
              <div className="font-medium">{pct(sc.acceptanceRate)}</div>
            </div>
            {typeof sc.posteriorAlpha === "number" && typeof sc.posteriorBeta === "number" && (
              <div className="col-span-2">
                <div className="text-muted-foreground">Posterior (α, β)</div>
                <div className="font-medium">
                  {sc.posteriorAlpha.toFixed(1)}, {sc.posteriorBeta.toFixed(1)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Lineage</CardTitle>
            <CardDescription>Parent chain (immutable forks)</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1 text-xs">
              {lineage.map((node, i) => (
                <li key={node.id} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{i === 0 ? "this" : `↑${i}`}</span>
                  <Link href={`/admin/outreach-lab/${node.id}`} className="hover:underline">
                    {node.label}
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Prompts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">System</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
              {config.systemPrompt}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">User template</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
              {config.userPromptTemplate}
            </pre>
          </div>
        </CardContent>
      </Card>

      {diffParent && (
        <ConfigDiff
          leftLabel={diffParent.label}
          rightLabel={config.label}
          leftSystem={diffParent.systemPrompt}
          rightSystem={config.systemPrompt}
          leftUser={diffParent.userPromptTemplate}
          rightUser={config.userPromptTemplate}
        />
      )}

      <EvalRunsTable
        runs={evalRuns as Array<{
          id: string;
          status: string;
          itemCount: number;
          passCount: number;
          failCount: number;
          hallucinationCount: number;
          pairwiseWins: number | null;
          pairwiseLosses: number | null;
          finishedAt: string | null;
          summary: unknown;
        }>}
        onRefresh={() => void load()}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sample generations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {sampleGenerations.length === 0 && (
            <p className="text-sm text-muted-foreground">No generations yet.</p>
          )}
          {sampleGenerations.map((g) => (
            <div key={g.id} className="rounded-md border p-2 text-xs">
              <div className="mb-1 flex gap-2">
                <Badge variant="outline">{g.zone}</Badge>
                <span className="text-muted-foreground">{g.id}</span>
              </div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(g.output).slice(0, 500)}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>

      <CreateVariantDialog
        open={forkOpen}
        onOpenChange={setForkOpen}
        parent={config}
        onCreated={(id) => {
          window.location.href = `/admin/outreach-lab/${id}`;
        }}
      />
      {promoteZone && (
        <PromoteSheet
          open={!!promoteZone}
          onOpenChange={(o) => {
            if (!o) setPromoteZone(null);
          }}
          configId={config.id}
          configLabel={config.label}
          toZone={promoteZone}
          onPromoted={() => void load()}
        />
      )}
      </PageBody>
    </>
  );
}
