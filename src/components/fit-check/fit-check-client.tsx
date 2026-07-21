"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Plus, Sparkles, History, UserCircle } from "lucide-react";
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

type FitCheckProfileOption = {
  id: string;
  name: string;
  displayLabel: string;
  stackLabel?: string;
  knowledgeLibraryIds: string[];
  knowledgeDocumentIds: string[];
};

function profileStorageKey(sourceType: OpportunitySourceType) {
  return `nova-fit-check-profile-${sourceType}`;
}

const PLACEHOLDER = `Paste the full job post, Upwork brief, RFP excerpt, or inbound email here.

Include: what they need, budget/rate if mentioned, timeline, tech stack, location, and any red flags you noticed.`;

export function FitCheckClient() {
  const { isDemo } = useWorkspace();
  const { openNewProspectForm } = useOpenQuickAdd();

  const [rawInput, setRawInput] = React.useState("");
  const [profileId, setProfileId] = React.useState<string>("");
  const [profileOptions, setProfileOptions] = React.useState<FitCheckProfileOption[]>([]);
  const [loadingProfiles, setLoadingProfiles] = React.useState(false);
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
    const handle = window.setTimeout(() => void loadScans(), 0);
    return () => window.clearTimeout(handle);
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
        // keep full set
      }
    })();
  }, []);

  React.useEffect(() => {
    if (availableSourceTypes.length === 0) return;
    if (!availableSourceTypes.includes(sourceType)) {
      const handle = window.setTimeout(() => setSourceType(availableSourceTypes[0]!), 0);
      return () => window.clearTimeout(handle);
    }
  }, [availableSourceTypes, sourceType]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoadingProfiles(true);
      try {
        const res = await fetch(
          `/api/ai/fit-check/profile-options?sourceType=${encodeURIComponent(sourceType)}`,
          { credentials: "same-origin" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { profiles?: FitCheckProfileOption[] };
        const list = data.profiles ?? [];
        if (cancelled) return;
        setProfileOptions(list);

        const saved =
          typeof window !== "undefined"
            ? window.localStorage.getItem(profileStorageKey(sourceType))
            : null;
        const validSaved = saved && list.some((p) => p.id === saved) ? saved : "";
        const keepCurrent = profileId && list.some((p) => p.id === profileId) ? profileId : "";
        const next = keepCurrent || validSaved || (list.length === 1 ? list[0]!.id : "");
        setProfileId(next);
      } finally {
        if (!cancelled) setLoadingProfiles(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, sourceType]);

  React.useEffect(() => {
    if (!profileId || typeof window === "undefined") return;
    window.localStorage.setItem(profileStorageKey(sourceType), profileId);
  }, [profileId, sourceType]);

  const selectedProfile = profileOptions.find((p) => p.id === profileId);
  const requiresProfile = profileOptions.length > 0;

  async function runCheck() {
    if (rawInput.trim().length < 40) {
      toast.error("Paste more detail about the opportunity (at least a few sentences).");
      return;
    }
    if (requiresProfile && !profileId) {
      toast.error("Choose which stack / persona fits this opportunity.");
      return;
    }
    if (
      requiresProfile &&
      selectedProfile &&
      selectedProfile.knowledgeLibraryIds.length === 0 &&
      selectedProfile.knowledgeDocumentIds.length === 0
    ) {
      toast.warning(
        `"${selectedProfile.displayLabel}" has no knowledge linked. Select libraries or documents in Admin → Profiles.`,
      );
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
          profileId: profileId || undefined,
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
        setProfileId(data.scan.profileId ?? "");
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
    setSourceType(availableSourceTypes[0] ?? "other");
    setProfileId("");
  }

  function handleCreateProspect() {
    if (!result) return;
    const notes = [
      selectedProfile || activeScan?.profileDisplayName
        ? `Persona: ${selectedProfile?.displayLabel ?? activeScan?.profileDisplayName}`
        : null,
      `Fit check: ${result.verdict} (${result.fitScore}%), ${result.fitLabel}`,
      result.summary,
      "",
      "Hooks:",
      ...result.hooks.map((h, i) => `${i + 1}. ${h.angle}\n${h.opener}`),
    ]
      .filter(Boolean)
      .join("\n");
    openNewProspectForm({
      source: "fit_check",
      destination: "/fit-check",
      sourceReference: activeScan?.id,
      prefill: {
        leadNotes: notes,
        channel: sourceTypeToChannel(sourceType),
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Fit Check"
        description="Pick the opportunity type and your stack persona, then paste the job to get a pursue / pass recommendation."
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
                      <span className="flex items-center gap-1 mt-0.5 text-muted-foreground flex-wrap">
                        <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", vm.className)}>
                          {s.fitScore}%
                        </Badge>
                        {s.profileDisplayName ? (
                          <span className="truncate max-w-[8rem]">{s.profileDisplayName}</span>
                        ) : null}
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
        </aside>

        <div className="flex-1 min-w-0 space-y-6">
          {!result ? (
            <div className="space-y-5">
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
                <Label className="text-sm">
                  <span className="text-muted-foreground font-normal mr-1">1.</span>
                  What kind of opportunity?
                </Label>
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
                <Label className="text-sm">
                  <span className="text-muted-foreground font-normal mr-1">2.</span>
                  Which stack / persona?
                </Label>
                {loadingProfiles ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading personas…
                  </p>
                ) : profileOptions.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground space-y-1">
                    <p>
                      No personas assigned to{" "}
                      <strong className="text-foreground">{OPPORTUNITY_SOURCE_LABELS[sourceType]}</strong>
                      . Using company default knowledge.
                    </p>
                    <p>
                      <Link href="/admin/profiles" className="underline underline-offset-2">
                        Admin → Profiles
                      </Link>{" "}
                     , open a profile, set Fit Check categories and link libraries.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {profileOptions.map((p) => (
                        <Button
                          key={p.id}
                          type="button"
                          size="sm"
                          variant={profileId === p.id ? "default" : "outline"}
                          className="h-8 text-xs gap-1"
                          onClick={() => setProfileId(p.id)}
                        >
                          <UserCircle className="h-3.5 w-3.5 opacity-80" />
                          {p.displayLabel}
                        </Button>
                      ))}
                    </div>
                    {selectedProfile &&
                    selectedProfile.knowledgeLibraryIds.length === 0 &&
                    selectedProfile.knowledgeDocumentIds.length === 0 ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Link knowledge libraries or documents (e.g. MERN Stack) in{" "}
                        <Link href="/admin/profiles" className="underline">
                          Admin → Profiles
                        </Link>
                        .
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="fit-paste" className="text-sm">
                  <span className="text-muted-foreground font-normal mr-1">3.</span>
                  Opportunity details
                </Label>
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
                Each persona uses its own knowledge libraries. Shared libraries (e.g. one MERN doc)
                can be linked to multiple profiles in{" "}
                <Link href="/admin/profiles" className="underline underline-offset-2">
                  Admin → Profiles
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              {activeScan?.profileDisplayName || selectedProfile ? (
                <p className="text-xs text-muted-foreground">
                  Evaluated as{" "}
                  <span className="font-medium text-foreground">
                    {activeScan?.profileDisplayName ?? selectedProfile?.displayLabel}
                  </span>{" "}
                  · {OPPORTUNITY_SOURCE_LABELS[sourceType]}
                </p>
              ) : null}
              <FitCheckResultView
                result={result}
                onDiscuss={() => setDiscussOpen(true)}
                onCreateProspect={handleCreateProspect}
              />
            </>
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
