"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProspectImportJob } from "@/lib/imports/prospect-import-types";
import {
  prospectDraftTitle,
  type ProspectDraftReadiness,
  type ProspectDraftSource,
} from "@/lib/prospects/draft-list";
import type { ProspectDraft } from "@/lib/prospects/draft-types";

type DraftStatus = "all" | ProspectDraft["status"];

type DraftPage = {
  drafts: ProspectDraft[];
  nextCursor?: string;
  hasMore: boolean;
};

const PENDING_IMPORT_STATUSES = new Set<ProspectImportJob["status"]>([
  "staging",
  "preview",
  "queued",
  "processing",
  "cancel_requested",
]);

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
}

async function loadDraftPage(
  status: DraftStatus,
  source: ProspectDraftSource,
  readiness: ProspectDraftReadiness,
  search: string,
  cursor?: string,
): Promise<DraftPage> {
  const params = new URLSearchParams({ owner: "me", limit: "25" });
  if (status !== "all") params.set("status", status);
  if (source !== "all") params.set("source", source);
  if (readiness !== "all") params.set("readiness", readiness);
  if (search.trim()) params.set("search", search.trim());
  if (cursor) params.set("cursor", cursor);
  return responseJson<DraftPage>(
    await fetch(`/api/prospect-drafts?${params.toString()}`),
    "Could not load prospect drafts.",
  );
}

async function loadPendingImports(): Promise<ProspectImportJob[]> {
  const response = await fetch("/api/org/imports", { cache: "no-store" });
  if (response.status === 401 || response.status === 403) return [];
  const body = await responseJson<{ jobs: ProspectImportJob[] }>(
    response,
    "Could not load import jobs.",
  );
  return body.jobs.filter((job) => PENDING_IMPORT_STATUSES.has(job.status));
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DraftActionButton({
  draft,
  onComplete,
}: {
  draft: ProspectDraft;
  onComplete: (draft: ProspectDraft) => void;
}) {
  const { openNewProspectForm } = useOpenQuickAdd();
  if (draft.status === "completed" && draft.leadId) {
    return (
      <Button
        variant="outline"
        size="xs"
        nativeButton={false}
        render={
          <Link href={`/leads/${draft.leadId}`}>
            <ExternalLink className="size-3.5" /> View prospect
          </Link>
        }
      />
    );
  }
  if (draft.status !== "active") return null;
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() => {
          if (draft.origin === "manual") {
            openNewProspectForm({
              source: "draft_center",
              destination: draft.destination ?? "/prospects/drafts",
              draftId: draft.id,
            });
            return;
          }
          window.location.assign(`/prospects/drafts/${draft.id}`);
        }}
      >
        <Play className="size-3.5" /> Resume
      </Button>
      <Button
        size="xs"
        disabled={draft.missingRequiredFields.length > 0}
        title={
          draft.missingRequiredFields.length
            ? "Complete the required fields before creating a prospect."
            : undefined
        }
        onClick={() => onComplete(draft)}
      >
        <Check className="size-3.5" /> Create prospect
      </Button>
    </>
  );
}

export function ProspectDraftsList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openNewProspectForm } = useOpenQuickAdd();
  const [search, setSearch] = React.useState("");
  const [source, setSource] = React.useState<ProspectDraftSource>("all");
  const [readiness, setReadiness] = React.useState<ProspectDraftReadiness>("all");
  const [status, setStatus] = React.useState<DraftStatus>("active");
  const [cursorStack, setCursorStack] = React.useState<Array<string | undefined>>([undefined]);
  const [busyId, setBusyId] = React.useState<string>();
  const [deleteDraft, setDeleteDraft] = React.useState<ProspectDraft>();
  const cursor = cursorStack.at(-1);

  const draftsQuery = useQuery({
    queryKey: [
      "prospect-drafts",
      "page",
      status,
      source,
      readiness,
      search.trim(),
      cursor ?? "first",
    ],
    queryFn: () => loadDraftPage(status, source, readiness, search, cursor),
  });
  const importsQuery = useQuery({
    queryKey: ["prospect-imports", "pending"],
    queryFn: loadPendingImports,
    staleTime: 30_000,
    retry: false,
  });
  const visibleDrafts = draftsQuery.data?.drafts ?? [];

  function changeStatus(next: DraftStatus) {
    setStatus(next);
    setCursorStack([undefined]);
  }

  async function duplicateDraft(draft: ProspectDraft) {
    setBusyId(draft.id);
    try {
      const values = Object.fromEntries(
        Object.entries(draft.fields).map(([key, field]) => [key, field?.value ?? ""]),
      );
      const body = await responseJson<{ draft: ProspectDraft }>(
        await fetch("/api/prospect-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values,
            form: draft.form,
            origin: "manual",
            sourceContext: "draft_center_duplicate",
            destination: "/prospects/drafts",
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
        "Could not duplicate draft.",
      );
      toast.success("Draft duplicated");
      await queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
      changeStatus("active");
      router.push(`/prospects/drafts/${body.draft.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not duplicate draft.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function completeDraft(draft: ProspectDraft) {
    setBusyId(draft.id);
    try {
      const body = await responseJson<{ leadId: string }>(
        await fetch(`/api/prospect-drafts/${encodeURIComponent(draft.id)}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: draft.revision }),
        }),
        "Could not create prospect.",
      );
      toast.success("Prospect created");
      await queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
      router.push(`/leads/${body.leadId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create prospect.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function confirmDelete() {
    if (!deleteDraft) return;
    setBusyId(deleteDraft.id);
    try {
      await responseJson<{ ok: true }>(
        await fetch(`/api/prospect-drafts/${encodeURIComponent(deleteDraft.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Deleted from draft center",
            revision: deleteDraft.revision,
          }),
        }),
        "Could not delete draft.",
      );
      toast.success("Draft deleted");
      setDeleteDraft(undefined);
      await queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete draft.");
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="space-y-5">
      {importsQuery.data?.length ? (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {importsQuery.data.length} pending import{" "}
                  {importsQuery.data.length === 1 ? "job" : "jobs"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {importsQuery.data
                    .map((job) => `${job.filename} (${statusLabel(job.status)})`)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/admin/import">View imports</Link>}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCursorStack([undefined]);
              }}
              placeholder="Search company, contact, email, or domain"
              className="pl-8"
              aria-label="Search drafts"
            />
          </div>
          <Select
            value={source}
            onValueChange={(value) => {
              setSource(value as ProspectDraftSource);
              setCursorStack([undefined]);
            }}
          >
            <SelectTrigger className="lg:w-44" aria-label="Filter by source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="intent_radar">Intent Radar</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={readiness}
            onValueChange={(value) => {
              setReadiness(value as ProspectDraftReadiness);
              setCursorStack([undefined]);
            }}
          >
            <SelectTrigger className="lg:w-44" aria-label="Filter by readiness">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All readiness</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="needs_review">Needs review</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => changeStatus(value as DraftStatus)}>
            <SelectTrigger className="lg:w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="discarded">Deleted</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() =>
              openNewProspectForm({
                source: "draft_center",
                destination: "/prospects/drafts",
              })
            }
          >
            <Plus className="size-4" /> New prospect
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden py-0">
        {draftsQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading drafts…
          </div>
        ) : draftsQuery.error ? (
          <div className="p-6 text-sm text-destructive">
            {draftsQuery.error instanceof Error
              ? draftsQuery.error.message
              : "Could not load prospect drafts."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prospect</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Readiness</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last saved</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDrafts.map((draft) => (
                <TableRow key={draft.id}>
                  <TableCell className="max-w-64">
                    <div className="truncate font-medium">{prospectDraftTitle(draft)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {draft.fields.contactName?.value || draft.fields.contactEmail?.value || "No contact yet"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {draft.origin === "intent_radar" ? "Intent Radar" : "Manual"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={draft.missingRequiredFields.length ? "secondary" : "default"}
                      >
                        {draft.missingRequiredFields.length ? "Needs review" : "Ready"}
                      </Badge>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {draft.completionPercent}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={draft.status === "active" ? "outline" : "secondary"}>
                      {draft.status === "discarded" ? "Deleted" : statusLabel(draft.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(draft.lastSavedAt).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      {busyId === draft.id ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                      <DraftActionButton draft={draft} onComplete={completeDraft} />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Duplicate ${prospectDraftTitle(draft)}`}
                        disabled={Boolean(busyId)}
                        onClick={() => void duplicateDraft(draft)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      {draft.status === "active" ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete ${prospectDraftTitle(draft)}`}
                          disabled={Boolean(busyId)}
                          onClick={() => setDeleteDraft(draft)}
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visibleDrafts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center text-muted-foreground">
                    No drafts match these filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Page {cursorStack.length} · {visibleDrafts.length} shown
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cursorStack.length === 1 || draftsQuery.isFetching}
              onClick={() => setCursorStack((current) => current.slice(0, -1))}
            >
              <ChevronLeft className="size-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!draftsQuery.data?.nextCursor || draftsQuery.isFetching}
              onClick={() =>
                setCursorStack((current) => [...current, draftsQuery.data?.nextCursor])
              }
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </Card>

      <AlertDialog
        open={Boolean(deleteDraft)}
        onOpenChange={(open) => {
          if (!open) setDeleteDraft(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDraft
                ? `${prospectDraftTitle(deleteDraft)} will move to deleted drafts and cannot be resumed.`
                : "This draft will no longer be resumable."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(busyId)}
              onClick={() => void confirmDelete()}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
