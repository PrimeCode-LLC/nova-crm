"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Plus, Sparkles, History } from "lucide-react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import {
  OPPORTUNITY_SOURCE_TYPES,
  OPPORTUNITY_SOURCE_LABELS,
  type OpportunityFitResult,
  type OpportunityFitScan,
  type OpportunitySourceType,
  verdictMeta,
  sourceTypeToChannel,
} from "@/lib/ai/opportunity-fit-types";
import { FitCheckResultView } from "@/components/fit-check/fit-check-result";
import { FitCheckDiscussSheet } from "@/components/fit-check/fit-check-discuss-sheet";

const PLACEHOLDER = `Paste the full job post, Upwork brief, RFP excerpt, or inbound email here.

Include: what they need, budget/rate if mentioned, timeline, tech stack, location, and any red flags you noticed.`;

export function FitCheckClient() {
  const { isDemo } = useWorkspace();
  const { openNewProspectForm } = useOpenQuickAdd();

  const [rawInput, setRawInput] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [sourceType, setSourceType] = React.useState<OpportunitySourceType>("other");
  const [availableSourceTypes, setAvailableSourceTypes] = React.useState<OpportunitySourceType[]>(
    [...OPPORTUNITY_SOURCE_TYPES],
  );
  const [analyzing, setAnalyzing] = React.useState(false);
  const [result, setResult] = React.useState<OpportunityFitResult | null>(null);
  const [activeScan, setActiveScan] = React.useState<OpportunityFitScan | null>(null);
  const [discussOpen, setDiscussOpen] = React.useState(false);

  const [scans, setScans] = React.useState<OpportunityFitScan[]>([]);
  const [elevated, setElevated] = React.useState(false);
  const [loadingScans, setLoadingScans] = React.useState(true);

  const loadScans = React.useCallback(async () => {
    setLoadingScans(true);
    try {
      const res = await fetch("/api/ai/opportunity-fit/scans", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { scans?: OpportunityFitScan[]; elevated?: boolean };
      setScans(data.scans ?? []);
      setElevated(data.elevated === true);
    } finally {
      setLoadingScans(false);
    }
  }, []);

  React.useEffect(() => {
    void loadScans();
  }, [loadScans]);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/ai/rag/fit-check-sources", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = (await res.json()) as { sourceTypes?: OpportunitySourceType[] };
        if (data.sourceTypes && data.sourceTypes.length > 0) {
          setAvailableSourceTypes(data.sourceTypes);
        }
      } catch {
        // If this endpoint fails, keep showing the full set.
      }
    })();
  }, []);

  React.useEffect(() => {
    if (availableSourceTypes.length === 0) return;
    if (!availableSourceTypes.includes(sourceType)) {
      setSourceType(availableSourceTypes[0]!);
    }
  }, [availableSourceTypes, sourceType]);

  async function runCheck() {
    if (rawInput.trim().length < 40) {
      toast.error("Paste more detail about the opportunity (at least a few sentences).");
      return;
    }
    setAnalyzing(true);
    setResult(null);
    setActiveScan(null);
    try {
      const res = await fetch("/api/ai/opportunity-fit/analyze", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput: rawInput.trim(),
          sourceType,
          title: title.trim() || undefined,
          demo: isDemo,
        }),
      });
      const data = (await res.json()) as {
        result?: OpportunityFitResult;
        scan?: OpportunityFitScan;
        error?: string;
        warning?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Analysis failed");
        return;
      }
      if (data.warning) toast.warning(data.warning);
      if (data.result) {
        setResult(data.result);
        if (data.scan) {
          setActiveScan(data.scan);
          setScans((prev) => [data.scan!, ...prev.filter((s) => s.id !== data.scan!.id)]);
        }
      }
    } catch {
      toast.error("Network error");
    } finally {
      setAnalyzing(false);
    }
  }

  async function openScan(scanId: string) {
    try {
      const res = await fetch(`/api/ai/opportunity-fit/scans/${scanId}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        toast.error("Could not load scan");
        return;
      }
      const data = (await res.json()) as { scan?: OpportunityFitScan };
      if (data.scan) {
        setActiveScan(data.scan);
        setResult(data.scan.result);
        setRawInput(data.scan.rawInput);
        setTitle(data.scan.title);
        setSourceType(data.scan.sourceType);
      }
    } catch {
      toast.error("Network error");
    }
  }

  function startNew() {
    setResult(null);
    setActiveScan(null);
    setRawInput("");
    setTitle("");
    setSourceType("other");
  }

  function handleCreateProspect() {
    if (!result) return;
    const notes = [
      `Fit check: ${result.verdict} (${result.fitScore}%) — ${result.fitLabel}`,
      result.summary,
      "",
      "Hooks:",
      ...result.hooks.map((h, i) => `${i + 1}. ${h.angle}\n${h.opener}`),
    ].join("\n");
    openNewProspectForm({
      leadNotes: notes,
      channel: sourceTypeToChannel(sourceType),
    });
  }

  return (
    <>
      <PageHeader
        title="Fit Check"
        description="Paste an opportunity and see how well it matches your company — with hooks and a clear pursue / pass recommendation."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={startNew}>
            <Plus className="h-3.5 w-3.5" /> New check
          </Button>
        }
      />
      <PageBody className="flex flex-col lg:flex-row gap-6 max-w-6xl">
        <aside className="w-full lg:w-56 shrink-0 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-1">
            <History className="h-3.5 w-3.5" />
            {elevated ? "Team history" : "Your history"}
          </div>
          {loadingScans ? (
            <p className="text-xs text-muted-foreground px-1 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </p>
          ) : scans.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1">No saved checks yet.</p>
          ) : (
            <ul className="space-y-0.5 max-h-[min(420px,50vh)] overflow-y-auto">
              {scans.map((s) => {
                const vm = verdictMeta(s.verdict);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => void openScan(s.id)}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1.5 text-xs hover:bg-muted/80 transition-colors",
                        activeScan?.id === s.id && "bg-muted",
                      )}
                    >
                      <span className="line-clamp-1 font-medium">{s.title}</span>
                      <span className="flex items-center gap-1 mt-0.5 text-muted-foreground">
                        <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", vm.className)}>
                          {s.fitScore}%
                        </Badge>
                        {elevated && s.createdByDisplayName ? (
                          <span className="truncate">{s.createdByDisplayName}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {elevated ? (
            <p className="text-[10px] text-muted-foreground px-1">
              As admin/director you see everyone&apos;s scans.
            </p>
          ) : null}
        </aside>

        <div className="flex-1 min-w-0 space-y-6">
          {!result ? (
            <div className="space-y-4">
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="fit-title">Title (optional)</Label>
                <Input
                  id="fit-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Acme React contract"
                />
              </div>

              <div className="space-y-2">
                <Label>What kind of opportunity?</Label>
                <div className="flex flex-wrap gap-1.5">
                  {availableSourceTypes.map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="sm"
                      variant={sourceType === t ? "default" : "outline"}
                      className="h-8 text-xs"
                      onClick={() => setSourceType(t)}
                    >
                      {OPPORTUNITY_SOURCE_LABELS[t]}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fit-paste">Opportunity details</Label>
                <Textarea
                  id="fit-paste"
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder={PLACEHOLDER}
                  rows={14}
                  className="font-mono text-sm"
                />
              </div>

              <Button type="button" disabled={analyzing} onClick={() => void runCheck()}>
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking fit…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Check fit
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground">
                Uses a <strong className="font-medium">global</strong> company library plus a{" "}
                <strong className="font-medium">category playbook</strong> for the type you select
                (connect global per category in{" "}
                <Link href="/admin/ai" className="underline underline-offset-2">
                  Admin → AI → Knowledge
                </Link>
                ).
              </p>
            </div>
          ) : (
            <FitCheckResultView
              result={result}
              onDiscuss={() => setDiscussOpen(true)}
              onCreateProspect={handleCreateProspect}
            />
          )}
        </div>
      </PageBody>

      <FitCheckDiscussSheet
        open={discussOpen}
        onOpenChange={setDiscussOpen}
        scan={activeScan}
        isDemo={isDemo}
      />
    </>
  );
}
