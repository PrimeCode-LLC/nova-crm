"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/error-logging/toast-error";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type {
  ProspectImportJob,
  ProspectImportPolicy,
} from "@/lib/imports/prospect-import-types";

const POLICY_OPTIONS: {
  value: ProspectImportPolicy;
  title: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    value: "add_new",
    title: "Add new prospects only",
    description: "Create unmatched prospects and skip contacts or prospects already in Nova.",
    recommended: true,
  },
  {
    value: "update_non_empty",
    title: "Update with non-empty values",
    description: "Update one matching prospect without clearing existing fields. Unmatched rows are created.",
  },
  {
    value: "replace",
    title: "Replace prospect data",
    description: "Replace supported lead/prospect fields. Shared account and contact fields only update when non-empty.",
  },
];

const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "cancelled",
  "failed",
]);

function statusLabel(status: ProspectImportJob["status"]): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export default function AdminImportPage() {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [job, setJob] = React.useState<ProspectImportJob | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [policy, setPolicy] = React.useState<ProspectImportPolicy>("add_new");
  const [reimportConfirmed, setReimportConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [recentJobs, setRecentJobs] = React.useState<ProspectImportJob[]>([]);
  const [issueFilter, setIssueFilter] = React.useState<"all" | "error" | "warning">("all");

  const isRunning = Boolean(job && ["queued", "processing", "cancel_requested"].includes(job.status));
  const isTerminal = Boolean(job && TERMINAL_STATUSES.has(job.status));
  const jobId = job?.id;
  const jobStatus = job?.status;
  const loadRecentJobs = React.useCallback(() => {
    return fetch("/api/org/imports", { cache: "no-store" })
      .then((response) => responseJson<{ jobs: ProspectImportJob[] }>(response))
      .then((data) => setRecentJobs(data.jobs))
      .catch(() => {});
  }, []);
  const filteredIssues = React.useMemo(
    () =>
      (job?.issueSamples ?? []).filter(
        (issue) => issueFilter === "all" || issue.severity === issueFilter,
      ),
    [issueFilter, job?.issueSamples],
  );

  React.useEffect(() => {
    void loadRecentJobs();
  }, [loadRecentJobs]);

  React.useEffect(() => {
    if (!jobId || !isRunning) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/org/imports/${jobId}`, { cache: "no-store" })
        .then((response) => responseJson<{ job: ProspectImportJob }>(response))
        .then((data) => setJob(data.job))
        .catch(() => {});
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [isRunning, jobId]);

  React.useEffect(() => {
    if (!jobStatus || !TERMINAL_STATUSES.has(jobStatus)) return;
    toast.success(
      jobStatus === "cancelled"
        ? "Prospect import cancelled"
        : `Prospect import ${statusLabel(jobStatus).toLowerCase()}`,
    );
    void loadRecentJobs();
  }, [jobStatus, loadRecentJobs]);

  async function previewFile(file: File) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      toast.error("Upload the official XLSX template or its CSV export.");
      return;
    }
    setSelectedFile(file);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/org/imports/preview", { method: "POST", body: form });
      const data = await responseJson<{ job: ProspectImportJob }>(response);
      setJob(data.job);
      setPolicy("add_new");
      setReimportConfirmed(false);
      toast.success(`Validated ${data.job.counts.total.toLocaleString()} rows`);
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Could not preview import", error, {
        location: "src/app/(app)/admin/import/page.tsx",
        functionName: "previewFile",
      });
    } finally {
      setBusy(false);
    }
  }

  async function startImport() {
    if (!job) return;
    if (job.duplicatePreviousJobId && !reimportConfirmed) {
      toast.error("Confirm that you want to re-import this exact file.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/org/imports/${job.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy, reimportConfirmed }),
      });
      const data = await responseJson<{ job: ProspectImportJob }>(response);
      setJob(data.job);
      toast.success("Import queued. It will continue if you leave this page.");
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Could not start import.", error, {
        location: "src/app/(app)/admin/import/page.tsx",
        functionName: "startImport",
      });
    } finally {
      setBusy(false);
    }
  }

  async function cancelImport() {
    if (!job) return;
    setBusy(true);
    try {
      const result = await responseJson<{
        ok: true;
        status: "cancel_requested" | "cancelled";
      }>(
        await fetch(`/api/org/imports/${job.id}/cancel`, { method: "POST" }),
      );
      setJob((current) => current ? { ...current, status: result.status } : current);
      toast.message(
        result.status === "cancelled"
          ? "Import cancelled. No prospect data was written."
          : "Cancellation requested. Completed rows will be kept.",
      );
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Could not cancel import.", error, {
        location: "src/app/(app)/admin/import/page.tsx",
        functionName: "cancelImport",
      });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (job && !isRunning) {
      void fetch(`/api/org/imports/${job.id}/cleanup`, { method: "POST" }).catch(() => {});
    }
    setJob(null);
    setSelectedFile(null);
    setPolicy("add_new");
    setReimportConfirmed(false);
    setIssueFilter("all");
    if (inputRef.current) inputRef.current.value = "";
    void loadRecentJobs();
  }

  const progress = job?.counts.total
    ? Math.min(100, Math.round((job.counts.processed / job.counts.total) * 100))
    : 0;

  return (
    <>
      <PageHeader
        title="Import Prospects"
        description="Validate up to 10,000 prospects, review duplicates, then run a durable background import."
      />
      <PageBody>
        <div className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">1. Download the official template</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Column names and order are fixed. Upload XLSX or a CSV exported from this template.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.assign("/api/org/imports/template?format=xlsx")}
                >
                  <Download className="h-4 w-4" /> XLSX template
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.assign("/api/org/imports/template?format=csv")}
                >
                  <Download className="h-4 w-4" /> CSV template
                </Button>
              </div>
            </div>
          </section>

          {!job ? (
            <>
              <section className="rounded-xl border bg-card p-5">
                <h2 className="text-sm font-semibold">2. Upload and validate</h2>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void previewFile(file);
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) void previewFile(file);
                  }}
                  className={cn(
                    "mt-4 flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
                    dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
                  )}
                >
                  {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-primary" />}
                  <span className="text-sm font-medium">{busy ? "Validating template…" : "Drop XLSX or CSV here, or browse"}</span>
                  <span className="text-xs text-muted-foreground">Maximum 10,000 rows and 20 MB</span>
                </button>
              </section>

              {recentJobs.length > 0 && (
                <section className="rounded-xl border bg-card p-5">
                  <h2 className="text-sm font-semibold">Recent imports</h2>
                  <div className="mt-3 divide-y rounded-md border">
                    {recentJobs.map((recent) => (
                      <button
                        type="button"
                        key={recent.id}
                        onClick={() => {
                          setSelectedFile(null);
                          setJob(recent);
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{recent.filename}</span>
                          <span className="block text-xs text-muted-foreground">
                            {new Date(recent.createdAt).toLocaleString()} · {recent.counts.total.toLocaleString()} rows
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {statusLabel(recent.status)}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              <section className="rounded-xl border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-6 w-6 text-primary" />
                    <div>
                      <h2 className="text-sm font-semibold">{selectedFile?.name ?? job.filename}</h2>
                      <p className="text-xs text-muted-foreground">
                        {job.counts.total.toLocaleString()} rows · {statusLabel(job.status)}
                      </p>
                    </div>
                  </div>
                  {!isRunning && (
                    <Button variant="outline" size="sm" onClick={() => void reset()}>
                      <RotateCcw className="h-4 w-4" /> Start over
                    </Button>
                  )}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Valid", job.counts.valid, "text-success"],
                    ["Invalid", job.counts.invalid, "text-destructive"],
                    ["Warnings", job.counts.warnings, "text-warning"],
                    ["In-file duplicates", job.counts.inFileDuplicates, "text-warning"],
                    ["Existing contacts", job.counts.existingContacts, "text-foreground"],
                    ["Existing prospects", job.counts.existingProspects, "text-foreground"],
                    ["Ambiguous prospects", job.counts.ambiguousProspects, "text-destructive"],
                    ["Total", job.counts.total, "text-foreground"],
                  ].map(([label, value, tone]) => (
                    <div key={String(label)} className="rounded-lg border bg-muted/10 p-3">
                      <div className={cn("text-xl font-semibold tabular-nums", tone)}>{Number(value).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
              </section>

              {job.status === "preview" && (
                <section className="rounded-xl border bg-card p-5">
                  <h2 className="text-sm font-semibold">3. Choose how to handle existing data</h2>
                  <RadioGroup
                    value={policy}
                    onValueChange={(value) => setPolicy(value as ProspectImportPolicy)}
                    className="mt-4 grid gap-3"
                  >
                    {POLICY_OPTIONS.map((option) => (
                      <Label
                        key={option.value}
                        htmlFor={`policy-${option.value}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                          policy === option.value && "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem id={`policy-${option.value}`} value={option.value} className="mt-0.5" />
                        <span>
                          <span className="block text-sm font-medium">
                            {option.title}
                            {option.recommended ? " (recommended)" : ""}
                          </span>
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">{option.description}</span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>

                  {job.duplicatePreviousJobId && (
                    <Label className="mt-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
                      <Checkbox
                        checked={reimportConfirmed}
                        onCheckedChange={(checked) => setReimportConfirmed(checked === true)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium">This exact file was uploaded before</span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          Confirm that you intentionally want to run it again using the selected policy.
                        </span>
                      </span>
                    </Label>
                  )}

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => window.location.assign(`/api/org/imports/${job.id}/report`)}
                    >
                      <Download className="h-4 w-4" /> Download issues
                    </Button>
                    <Button
                      onClick={() => void startImport()}
                      disabled={busy || job.counts.valid === 0 || Boolean(job.duplicatePreviousJobId && !reimportConfirmed)}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Confirm and start
                    </Button>
                  </div>
                </section>
              )}

              {(isRunning || isTerminal) && (
                <section className="rounded-xl border bg-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">Background import</h2>
                      <p className="text-xs text-muted-foreground">
                        You may close this page. Nova will notify you when processing finishes.
                      </p>
                    </div>
                    {isRunning && (
                      <Button variant="outline" size="sm" onClick={() => void cancelImport()} disabled={busy || job.status === "cancel_requested"}>
                        <XCircle className="h-4 w-4" /> Cancel
                      </Button>
                    )}
                  </div>
                  <Progress value={progress} className="mt-5" />
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>{job.counts.processed.toLocaleString()} / {job.counts.total.toLocaleString()} rows</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Created", job.counts.created],
                      ["Updated", job.counts.updated],
                      ["Skipped", job.counts.skipped],
                      ["Failed", job.counts.failed],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md bg-muted/30 p-3">
                        <div className="text-lg font-semibold">{Number(value).toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {job.issueSamples.length > 0 && (
                <section className="rounded-xl border bg-card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-warning" />
                      <h2 className="text-sm font-semibold">Issue samples</h2>
                    </div>
                    <div className="flex gap-1">
                      {(["all", "error", "warning"] as const).map((filter) => (
                        <Button
                          key={filter}
                          type="button"
                          size="xs"
                          variant={issueFilter === filter ? "secondary" : "ghost"}
                          onClick={() => setIssueFilter(filter)}
                        >
                          {filter === "all" ? "All" : filter === "error" ? "Errors" : "Warnings"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 max-h-80 divide-y overflow-auto rounded-md border">
                    {filteredIssues.slice(0, 100).map((issue, index) => (
                      <div key={`${issue.rowNumber}-${issue.code}-${index}`} className="flex gap-3 px-3 py-2 text-xs">
                        <span className="w-16 shrink-0 font-medium">Row {issue.rowNumber}</span>
                        <span className={issue.severity === "error" ? "text-destructive" : "text-warning"}>
                          {issue.field ? `${issue.field}: ` : ""}{issue.message}
                        </span>
                      </div>
                    ))}
                    {filteredIssues.length === 0 && (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        No issues match this filter.
                      </p>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}
