"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Eye, Pencil, RotateCcw, Trash2 } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { can } from "@/lib/permissions/can";
import { cn } from "@/lib/utils";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import { fmtRelative } from "@/lib/format";
import {
  resolveBrandResponsibility,
  type ContentCapture,
  type ContentCaptureRequiredField,
  type ContentCaptureType,
} from "@/lib/content-calendar/types";
import {
  brandCapturePolicy,
  brandsNeedingCaptureAttention,
  getCaptureProgress,
  validateCaptureFields,
} from "@/lib/content-calendar/capture-policy";
import {
  CAPTURE_TYPE_FIELDS,
  CONTENT_CAPTURE_TYPES,
  CONTENT_CAPTURE_TYPE_HINTS,
  CONTENT_CAPTURE_TYPE_LABELS,
  captureDisplayTitle,
  captureFieldLabel,
  normalizeCaptureType,
} from "@/lib/content-calendar/capture-types";
import {
  loadCapturePrefs,
  rememberCaptureLibrary,
  sortLibrariesForCapturePerson,
  type ContentCapturePrefs,
} from "@/lib/content-calendar/capture-prefs";
import { UserChip } from "@/components/common/user-chip";

/** Flip to true when brand attribution / plan-queue is needed again on Capture. */
const CAPTURE_BRAND_ENABLED = false;

type CaptureLibraryOption = {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
};

function CaptureFieldBlock({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{value}</p>
    </div>
  );
}

type NormalizeResponse = {
  error?: string;
  title?: string;
  documentId?: string;
  libraryId?: string;
  status?: "indexed";
  normalizedTitle?: string;
  normalizedMarkdown?: string;
};

export function ContentCaptureClient() {
  const navAccess = useNavAccessContext();
  const data = useContentCalendarData();
  const permissionSubject = React.useMemo(
    () => ({
      roleId: navAccess.roleId ?? "salesperson",
      isSuperAdmin: Boolean(navAccess.isSuperAdmin),
      featureGrants: navAccess.featureGrants,
      orgRole: navAccess.orgRole,
      roleSnapshot: navAccess.roleSnapshot,
    }),
    [navAccess],
  );
  const canCreate = can(permissionSubject, "content_calendar", "create");
  // Capturers usually have create but not module edit/delete — still need to fix/remove captures.
  const canEditCapture =
    canCreate || can(permissionSubject, "content_calendar", "edit");
  const canDeleteCapture =
    canCreate || can(permissionSubject, "content_calendar", "delete");

  const [libraryId, setLibraryId] = React.useState("");
  const [brandId, setBrandId] = React.useState("");
  const [captureType, setCaptureType] = React.useState<ContentCaptureType>("win");
  const [problem, setProblem] = React.useState("");
  const [solution, setSolution] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [publicSafe, setPublicSafe] = React.useState(true);
  const [queueForPosts, setQueueForPosts] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ContentCapture | null>(null);
  const [viewTarget, setViewTarget] = React.useState<ContentCapture | null>(null);
  const [editTarget, setEditTarget] = React.useState<ContentCapture | null>(null);
  const [editLibraryId, setEditLibraryId] = React.useState("");
  const [editBrandId, setEditBrandId] = React.useState("");
  const [editCaptureType, setEditCaptureType] = React.useState<ContentCaptureType>("win");
  const [editProblem, setEditProblem] = React.useState("");
  const [editSolution, setEditSolution] = React.useState("");
  const [editOutcome, setEditOutcome] = React.useState("");
  const [editNotes, setEditNotes] = React.useState("");
  const [editPublicSafe, setEditPublicSafe] = React.useState(true);
  const [editQueueForPosts, setEditQueueForPosts] = React.useState(false);
  const [libraries, setLibraries] = React.useState<CaptureLibraryOption[]>([]);
  const [librariesLoading, setLibrariesLoading] = React.useState(true);
  const [prefs, setPrefs] = React.useState<ContentCapturePrefs>({ preferredLibraryIds: [] });

  React.useEffect(() => {
    setPrefs(loadCapturePrefs(data.organizationId, data.currentUserId));
  }, [data.organizationId, data.currentUserId]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLibrariesLoading(true);
      if (data.isDemo) {
        if (!cancelled) {
          setLibraries([
            {
              id: "lib-demo-ops",
              name: "Ops / delivery",
              description: "Operational lessons and process proof",
              documentCount: 2,
            },
            {
              id: "lib-demo-founder",
              name: "Founder / daily life",
              description: "Personal and hiring narratives",
              documentCount: 1,
            },
            {
              id: "lib-demo-product",
              name: "Product / Nova",
              description: "Product delivery case studies",
              documentCount: 0,
            },
          ]);
          setLibrariesLoading(false);
        }
        return;
      }
      try {
        const res = await fetch("/api/ai/content-capture/libraries", {
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (!cancelled) setLibraries([]);
          return;
        }
        const json = (await res.json()) as {
          libraries?: {
            id: string;
            name?: string;
            description?: string;
            documentCount?: number;
          }[];
        };
        if (cancelled) return;
        setLibraries(
          (json.libraries ?? []).map((l) => ({
            id: l.id,
            name: l.name?.trim() || l.id,
            description: l.description,
            documentCount: Number(l.documentCount ?? 0) || 0,
          })),
        );
      } catch {
        if (!cancelled) setLibraries([]);
      } finally {
        if (!cancelled) setLibrariesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.isDemo]);

  const selectedBrand = data.brands.find((b) => b.id === brandId);
  const editSelectedBrand = data.brands.find((b) => b.id === editBrandId);
  const sortedLibraries = React.useMemo(
    () =>
      sortLibrariesForCapturePerson(
        libraries,
        prefs,
        selectedBrand?.knowledgeLibraryIds,
      ),
    [libraries, prefs, selectedBrand?.knowledgeLibraryIds],
  );
  const editSortedLibraries = React.useMemo(
    () =>
      sortLibrariesForCapturePerson(
        libraries,
        prefs,
        editSelectedBrand?.knowledgeLibraryIds,
      ),
    [libraries, prefs, editSelectedBrand?.knowledgeLibraryIds],
  );

  React.useEffect(() => {
    if (libraryId || sortedLibraries.length === 0) return;
    const preferred =
      (prefs.lastLibraryId &&
        sortedLibraries.find((l) => l.id === prefs.lastLibraryId)?.id) ||
      prefs.preferredLibraryIds.find((id) => sortedLibraries.some((l) => l.id === id)) ||
      sortedLibraries[0]?.id;
    if (preferred) setLibraryId(preferred);
  }, [libraryId, sortedLibraries, prefs.lastLibraryId, prefs.preferredLibraryIds]);

  const selectedLibrary = libraries.find((l) => l.id === libraryId);
  const brandsUsingLibrary = React.useMemo(
    () =>
      libraryId
        ? data.brands.filter((b) => b.knowledgeLibraryIds?.includes(libraryId))
        : [],
    [data.brands, libraryId],
  );

  const capturerId = selectedBrand
    ? resolveBrandResponsibility(selectedBrand, "capturer")
    : "";
  const policy = selectedBrand
    ? brandCapturePolicy(selectedBrand)
    : brandCapturePolicy({});
  const editPolicy = editSelectedBrand
    ? brandCapturePolicy(editSelectedBrand)
    : brandCapturePolicy({});
  const progress = selectedBrand
    ? getCaptureProgress({
        brand: selectedBrand,
        captures: data.captures,
        currentUserId: data.currentUserId,
        nowMs: Date.now(),
      })
    : null;
  const attention = React.useMemo(
    () =>
      brandsNeedingCaptureAttention({
        brands: data.brands,
        captures: data.captures,
        currentUserId: data.currentUserId,
        nowMs: Date.now(),
      }),
    [data.brands, data.captures, data.currentUserId],
  );

  function focusBrandCapture(brand: (typeof data.brands)[number]) {
    setBrandId(brand.id);
    const linked = brand.knowledgeLibraryIds?.find((id) =>
      libraries.some((l) => l.id === id),
    );
    if (linked) setLibraryId(linked);
  }

  const libraryName = (id?: string) =>
    (id && libraries.find((l) => l.id === id)?.name) || id || "";

  async function runNormalize(captureId: string): Promise<NormalizeResponse | null> {
    const res = await fetch("/api/ai/content-capture-normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureId }),
    });
    const json = (await res.json().catch(() => ({}))) as NormalizeResponse;
    if (!res.ok) {
      await data.updateCapture(captureId, {
        status: "failed",
        errorMessage: json.error || "Normalize failed",
      });
      toast.error(json.error || "Normalize failed");
      return null;
    }
    await data.updateCapture(captureId, {
      status: "indexed",
      normalizedTitle: json.normalizedTitle ?? json.title,
      normalizedMarkdown: json.normalizedMarkdown,
      knowledgeDocumentId: json.documentId,
      libraryId: json.libraryId,
      errorMessage: null,
    });    return json;
  }

  async function submit() {
    if (!canCreate) return;
    if (!libraryId) {
      toast.error("Select a knowledgebase to index into.");
      return;
    }
    if (CAPTURE_BRAND_ENABLED && queueForPosts && !brandId) {
      toast.error("Pick a brand to flag this for an upcoming content plan.");
      return;
    }
    const check = validateCaptureFields(policy, {
      problem,
      solution,
      outcome,
      notes,
    });
    if (!check.ok) {
      toast.error(
        `Required: ${check.missing.map((f) => captureFieldLabel(captureType, f)).join(", ")}`,
      );
      return;
    }
    setBusy(true);
    try {
      const effectiveBrandId = CAPTURE_BRAND_ENABLED ? brandId : "";
      const capture = await data.createCapture({
        libraryId,
        brandId: effectiveBrandId || undefined,
        captureType,
        problem: problem.trim(),
        solution: solution.trim(),
        outcome: outcome.trim() || undefined,
        notes: notes.trim() || undefined,
        publicSafe,
        queueForPosts: CAPTURE_BRAND_ENABLED && queueForPosts && Boolean(effectiveBrandId),
      });
      if (!capture) {
        toast.error("Could not save capture");
        return;
      }
      setPrefs(rememberCaptureLibrary(data.organizationId, data.currentUserId, libraryId));
      if (data.isDemo) {
        await data.updateCapture(capture.id, {
          status: "indexed",
          normalizedTitle: capture.problem.slice(0, 80),
          libraryId,
        });
        toast.message("Demo mode - capture saved locally only");
        setProblem("");
        setSolution("");
        setOutcome("");
        setNotes("");
        setQueueForPosts(false);
        return;
      }
      const json = await runNormalize(capture.id);
      if (!json) return;
      const libLabel =
        libraries.find((l) => l.id === (json.libraryId ?? libraryId))?.name ??
        "knowledge library";
      const brandLabel = effectiveBrandId
        ? data.brands.find((b) => b.id === effectiveBrandId)?.name
        : undefined;
      toast.success(json.title ? `Indexed: ${json.title}` : "Captured and indexed", {
        description: brandLabel
          ? `Saved to ${libLabel} · used by ${brandLabel}`
          : `Saved to ${libLabel}`,
        action: {
          label: "View knowledge",
          onClick: () => {
            window.location.href = "/admin/ai?tab=libraries";
          },
        },
      });
      setProblem("");
      setSolution("");
      setOutcome("");
      setNotes("");
      setQueueForPosts(false);
    } catch {
      toast.error("Capture failed");
    } finally {
      setBusy(false);
    }
  }

  async function retryCapture(capture: ContentCapture) {
    setActionId(capture.id);
    try {
      if (!capture.libraryId) {
        if (!libraryId) {
          toast.error("Select a knowledgebase, then retry index.");
          return;
        }
        await data.updateCapture(capture.id, { libraryId });
      }
      const json = await runNormalize(capture.id);
      if (json) {
        toast.success(json.title ? `Indexed: ${json.title}` : "Capture indexed");
      }
    } catch {
      toast.error("Retry failed");
    } finally {
      setActionId(null);
    }
  }

  function openEdit(capture: ContentCapture) {
    setViewTarget(null);
    setEditTarget(capture);
    setEditLibraryId(capture.libraryId || libraryId || "");
    setEditBrandId(capture.brandId || "");
    setEditCaptureType(normalizeCaptureType(capture.captureType));
    setEditProblem(capture.problem);
    setEditSolution(capture.solution);
    setEditOutcome(capture.outcome || "");
    setEditNotes(capture.notes || "");
    setEditPublicSafe(capture.publicSafe);
    setEditQueueForPosts(Boolean(capture.queueForPosts));
  }

  async function saveEdit() {
    if (!editTarget || !canEditCapture) return;
    if (!editLibraryId) {
      toast.error("Select a knowledgebase to index into.");
      return;
    }
    if (CAPTURE_BRAND_ENABLED && editQueueForPosts && !editBrandId) {
      toast.error("Pick a brand to flag this for an upcoming content plan.");
      return;
    }
    const check = validateCaptureFields(editPolicy, {
      problem: editProblem,
      solution: editSolution,
      outcome: editOutcome,
      notes: editNotes,
    });
    if (!check.ok) {
      toast.error(
        `Required: ${check.missing.map((f) => captureFieldLabel(editCaptureType, f)).join(", ")}`,
      );
      return;
    }
    const id = editTarget.id;
    setActionId(id);
    try {
      const effectiveEditBrandId = CAPTURE_BRAND_ENABLED ? editBrandId : editTarget.brandId || "";
      const patch: Parameters<typeof data.updateCapture>[1] = {
        libraryId: editLibraryId,
        captureType: editCaptureType,
        problem: editProblem.trim(),
        solution: editSolution.trim(),
        outcome: editOutcome.trim() || undefined,
        notes: editNotes.trim() || undefined,
        publicSafe: editPublicSafe,
        queueForPosts: CAPTURE_BRAND_ENABLED && editQueueForPosts && Boolean(effectiveEditBrandId),
      };
      if (CAPTURE_BRAND_ENABLED && effectiveEditBrandId) patch.brandId = effectiveEditBrandId;
      await data.updateCapture(id, patch);
      setPrefs(rememberCaptureLibrary(data.organizationId, data.currentUserId, editLibraryId));
      if (data.isDemo) {
        await data.updateCapture(id, {
          status: "indexed",
          normalizedTitle: editProblem.trim().slice(0, 80),
          libraryId: editLibraryId,
        });
        toast.message("Demo mode - capture updated locally only");
        setEditTarget(null);
        return;
      }
      const json = await runNormalize(id);
      if (!json) return;
      toast.success(json.title ? `Updated: ${json.title}` : "Capture updated and re-indexed");
      setEditTarget(null);
    } catch {
      toast.error("Update failed");
    } finally {
      setActionId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setActionId(id);
    try {
      const ok = await data.deleteCapture(id);
      if (ok) {
        toast.success("Capture deleted");
        setDeleteTarget(null);
      }
    } finally {
      setActionId(null);
    }
  }

  function fieldRequired(field: ContentCaptureRequiredField): boolean {
    return policy.requiredFields.includes(field);
  }

  function editFieldRequired(field: ContentCaptureRequiredField): boolean {
    return editPolicy.requiredFields.includes(field);
  }

  return (
    <AppPage>
      <PageHeader
        title="Capture"
        description="Feed product knowledge, wins, ICP notes, and voice into your knowledgebases — AI structures and indexes them for posts, sequences, and Fit Check."
        actions={
          <Link href="/content" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Calendar
          </Link>
        }
      />
      <PageBody>
        {attention.length > 0 ? (
          <div className="mb-4 space-y-2">
            {attention.map(({ brand, progress: p }) => (
              <div
                key={brand.id}
                className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
              >
                <span className="font-medium">{brand.name}</span>
                {": "}
                {p.behindCadence && p.target > 0
                  ? `${p.weekCount}/${p.target} captures this week`
                  : null}
                {p.behindCadence && p.idle ? " · " : null}
                {p.idle
                  ? p.daysSinceLast == null
                    ? "no captures yet"
                    : `idle ${p.daysSinceLast}+ days (limit ${p.policy.idleDays})`
                  : null}
                {" · "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => focusBrandCapture(brand)}
                >
                  Capture now
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New capture</CardTitle>
              <CardDescription>
                ~60 seconds. Pick a type, jot the note, AI indexes into the selected knowledgebase.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>What are you capturing?</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CONTENT_CAPTURE_TYPES.map((type) => {
                    const selected = captureType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                        onClick={() => setCaptureType(type)}
                      >
                        {CONTENT_CAPTURE_TYPE_LABELS[type]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {CONTENT_CAPTURE_TYPE_HINTS[captureType]}
                </p>
              </div>
              <div className="space-y-2">
                <Label>
                  Knowledgebase <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={libraryId || null}
                  onValueChange={(v) => {
                    if (v) setLibraryId(v);
                  }}
                  disabled={librariesLoading || sortedLibraries.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={librariesLoading ? "Loading…" : "Select knowledgebase"}>
                      {selectedLibrary?.name ??
                        (librariesLoading ? "Loading…" : "Select knowledgebase")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sortedLibraries.map((l) => {
                      const isPreferred =
                        prefs.lastLibraryId === l.id ||
                        prefs.preferredLibraryIds.includes(l.id);
                      return (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                          {isPreferred ? " · yours" : ""}
                          {l.documentCount > 0 ? ` (${l.documentCount})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {!librariesLoading && sortedLibraries.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No knowledge libraries yet. Create them under{" "}
                    <Link href="/admin/ai?tab=libraries" className="underline">
                      AI &amp; knowledge → Libraries
                    </Link>{" "}
                    (or link them on a brand).
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Indexes into this org library. Content, email sequences, and Fit Check can
                    retrieve it when linked.
                    {brandsUsingLibrary.length > 0
                      ? ` Used by: ${brandsUsingLibrary.map((b) => b.name).join(", ")}.`
                      : ""}
                  </p>
                )}
                {selectedLibrary?.description?.trim() ? (
                  <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2">
                    {selectedLibrary.description.trim()}
                  </p>
                ) : null}
              </div>
              {CAPTURE_BRAND_ENABLED ? (
                <div className="space-y-2">
                  <Label>Brand (optional)</Label>
                  <Select
                    value={brandId || "none"}
                    onValueChange={(v) => {
                      const next = !v || v === "none" ? "" : v;
                      setBrandId(next);
                      if (!next && queueForPosts) setQueueForPosts(false);
                      if (next) {
                        const brand = data.brands.find((b) => b.id === next);
                        const linked = brand?.knowledgeLibraryIds?.find((id) =>
                          libraries.some((l) => l.id === id),
                        );
                        if (linked && !libraryId) setLibraryId(linked);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Brand">
                        {brandId ? selectedBrand?.name : "None — knowledge only"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None — knowledge only</SelectItem>
                      {data.brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {capturerId ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      Capturer for this brand: <UserChip userId={capturerId} size="xs" />
                    </p>
                  ) : null}
                  {selectedBrand && progress ? (
                    <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground space-y-1">
                      {progress.target > 0 ? (
                        <p>
                          This week:{" "}
                          <span
                            className={cn(
                              "font-medium",
                              progress.behindCadence
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-foreground",
                            )}
                          >
                            {progress.weekCount}/{progress.target}
                          </span>{" "}
                          indexed captures
                        </p>
                      ) : (
                        <p>No weekly capture quota set for this brand.</p>
                      )}
                      <p>
                        Idle after {progress.policy.idleDays} days
                        {progress.policy.remindersEnabled ? " · reminders on" : " · reminders off"}
                      </p>
                      {progress.policy.requirementsNotes ? (
                        <p className="text-foreground/90 pt-1">
                          {progress.policy.requirementsNotes}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {CAPTURE_TYPE_FIELDS[captureType].map((field) => {
                const value =
                  field.key === "problem"
                    ? problem
                    : field.key === "solution"
                      ? solution
                      : field.key === "outcome"
                        ? outcome
                        : notes;
                const setValue =
                  field.key === "problem"
                    ? setProblem
                    : field.key === "solution"
                      ? setSolution
                      : field.key === "outcome"
                        ? setOutcome
                        : setNotes;
                const required = fieldRequired(field.key);
                const showOptional = Boolean(field.optional) && !required;
                return (
                  <div key={field.key} className="space-y-2">
                    <Label>
                      {field.label}
                      {required ? <span className="text-destructive"> *</span> : null}
                      {showOptional ? " (optional)" : null}
                    </Label>
                    <Textarea
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      rows={field.rows}
                      placeholder={field.placeholder}
                    />
                  </div>
                );
              })}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={publicSafe} onCheckedChange={(c) => setPublicSafe(c === true)} />
                Public-safe (ok to use in posts)
              </label>
              {CAPTURE_BRAND_ENABLED ? (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={queueForPosts}
                      disabled={!brandId}
                      onCheckedChange={(c) => setQueueForPosts(c === true)}
                    />
                    Flag for upcoming content plan
                  </label>
                  {!brandId ? (
                    <p className="text-xs text-muted-foreground -mt-2">
                      Select a brand to queue this capture for plan suggestions.
                    </p>
                  ) : null}
                </>
              ) : null}
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !canCreate || !libraryId || librariesLoading}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Capture &amp; index
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent captures</CardTitle>
              <CardDescription>Saved permanently. Delete removes the linked knowledge doc too.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.captures.length === 0 ? (
                <p className="text-sm text-muted-foreground">No captures yet.</p>
              ) : (
                [...data.captures]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 20)
                  .map((c) => {
                    const acting = actionId === c.id;
                    const canRetry = c.status === "failed" || c.status === "draft";
                    return (
                      <div key={c.id} className="rounded-md border px-3 py-2 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            className="font-medium line-clamp-1 text-left hover:underline underline-offset-2"
                            onClick={() => setViewTarget(c)}
                          >
                            {captureDisplayTitle(c)}
                          </button>
                          <Badge
                            variant={
                              c.status === "indexed"
                                ? "default"
                                : c.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {c.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {fmtRelative(c.createdAt)}
                          {` · ${CONTENT_CAPTURE_TYPE_LABELS[normalizeCaptureType(c.captureType)]}`}
                          {c.libraryId ? ` · ${libraryName(c.libraryId)}` : ""}
                          {c.publicSafe ? " · public-safe" : " · internal"}
                          {c.queueForPosts ? " · queued" : ""}
                        </div>
                        {c.status === "failed" && c.errorMessage ? (
                          <p className="mt-1 text-xs text-destructive line-clamp-2">
                            {c.errorMessage}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={acting || busy}
                            onClick={() => setViewTarget(c)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                          {canEditCapture ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={acting || busy}
                              onClick={() => openEdit(c)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          ) : null}
                          {canRetry && canCreate ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={acting || busy}
                              onClick={() => void retryCapture(c)}
                            >
                              {acting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              Retry index
                            </Button>
                          ) : null}
                          {canDeleteCapture ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={acting || busy}
                              onClick={() => setDeleteTarget(c)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>

      <Dialog
        open={Boolean(viewTarget)}
        onOpenChange={(open) => {
          if (!open) setViewTarget(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 border-b px-6 py-4 text-left">
            <DialogTitle className="pr-8 leading-snug">
              {viewTarget ? captureDisplayTitle(viewTarget) : "Capture"}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
              {viewTarget ? (
                <>
                  <Badge
                    variant={
                      viewTarget.status === "indexed"
                        ? "default"
                        : viewTarget.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {viewTarget.status}
                  </Badge>
                  <span>
                    {CONTENT_CAPTURE_TYPE_LABELS[normalizeCaptureType(viewTarget.captureType)]}
                  </span>
                  <span>·</span>
                  <span>{fmtRelative(viewTarget.createdAt)}</span>
                  <span>·</span>
                  <span>{viewTarget.publicSafe ? "public-safe" : "internal"}</span>
                  {viewTarget.queueForPosts ? (
                    <>
                      <span>·</span>
                      <span>queued for posts</span>
                    </>
                  ) : null}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {viewTarget ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
              <div className="space-y-5 pb-2">
                {viewTarget.libraryId ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Knowledgebase
                    </p>
                    <p className="text-sm">{libraryName(viewTarget.libraryId)}</p>
                  </div>
                ) : null}
                {viewTarget.brandId ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Brand
                    </p>
                    <p className="text-sm">
                      {data.brands.find((b) => b.id === viewTarget.brandId)?.name ||
                        viewTarget.brandId}
                    </p>
                  </div>
                ) : null}
                {CAPTURE_TYPE_FIELDS[normalizeCaptureType(viewTarget.captureType)].map((field) => (
                  <CaptureFieldBlock
                    key={field.key}
                    label={field.label}
                    value={viewTarget[field.key]}
                  />
                ))}
                {viewTarget.status === "failed" && viewTarget.errorMessage ? (
                  <CaptureFieldBlock label="Error" value={viewTarget.errorMessage} />
                ) : null}
                <CaptureFieldBlock
                  label="Indexed case study"
                  value={viewTarget.normalizedMarkdown}
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open && !actionId) setEditTarget(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 border-b px-6 py-4 text-left">
            <DialogTitle>Edit capture</DialogTitle>
            <DialogDescription>
              Updates the capture and re-indexes the linked knowledge document.
            </DialogDescription>
          </DialogHeader>
          {editTarget ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
              <div className="space-y-4 pb-2">
                <div className="space-y-2">
                  <Label>
                    Knowledgebase <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={editLibraryId || null}
                    onValueChange={(v) => {
                      if (v) setEditLibraryId(v);
                    }}
                    disabled={Boolean(actionId) || librariesLoading || editSortedLibraries.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={librariesLoading ? "Loading…" : "Select knowledgebase"}>
                        {libraries.find((l) => l.id === editLibraryId)?.name ??
                          (librariesLoading ? "Loading…" : "Select knowledgebase")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {editSortedLibraries.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                          {l.documentCount > 0 ? ` (${l.documentCount})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {CAPTURE_BRAND_ENABLED ? (
                  <div className="space-y-2">
                    <Label>Brand (optional)</Label>
                    <Select
                      value={editBrandId || "none"}
                      disabled={Boolean(actionId)}
                      onValueChange={(v) => {
                        const next = !v || v === "none" ? "" : v;
                        setEditBrandId(next);
                        if (!next && editQueueForPosts) setEditQueueForPosts(false);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Brand">
                          {editBrandId ? editSelectedBrand?.name : "None — knowledge only"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None — knowledge only</SelectItem>
                        {data.brands.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label>What are you capturing?</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {CONTENT_CAPTURE_TYPES.map((type) => {
                      const selected = editCaptureType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          disabled={Boolean(actionId)}
                          className={cn(
                            "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                          onClick={() => setEditCaptureType(type)}
                        >
                          {CONTENT_CAPTURE_TYPE_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {CONTENT_CAPTURE_TYPE_HINTS[editCaptureType]}
                  </p>
                </div>
                {CAPTURE_TYPE_FIELDS[editCaptureType].map((field) => {
                  const value =
                    field.key === "problem"
                      ? editProblem
                      : field.key === "solution"
                        ? editSolution
                        : field.key === "outcome"
                          ? editOutcome
                          : editNotes;
                  const setValue =
                    field.key === "problem"
                      ? setEditProblem
                      : field.key === "solution"
                        ? setEditSolution
                        : field.key === "outcome"
                          ? setEditOutcome
                          : setEditNotes;
                  const required = editFieldRequired(field.key);
                  const showOptional = Boolean(field.optional) && !required;
                  return (
                    <div key={field.key} className="space-y-2">
                      <Label>
                        {field.label}
                        {required ? <span className="text-destructive"> *</span> : null}
                        {showOptional ? " (optional)" : null}
                      </Label>
                      <Textarea
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        rows={field.rows}
                        placeholder={field.placeholder}
                        disabled={Boolean(actionId)}
                      />
                    </div>
                  );
                })}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={editPublicSafe}
                    disabled={Boolean(actionId)}
                    onCheckedChange={(c) => setEditPublicSafe(c === true)}
                  />
                  Public-safe (ok to use in posts)
                </label>
                {CAPTURE_BRAND_ENABLED ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editQueueForPosts}
                      disabled={Boolean(actionId) || !editBrandId}
                      onCheckedChange={(c) => setEditQueueForPosts(c === true)}
                    />
                    Flag for upcoming content plan
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}
          <DialogFooter className="mx-0 mb-0 shrink-0 gap-2 rounded-none border-t bg-transparent px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(actionId)}
              onClick={() => setEditTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={Boolean(actionId) || !editLibraryId || librariesLoading}
              onClick={() => void saveEdit()}
            >
              {actionId === editTarget?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save &amp; re-index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete capture?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved problem/solution
              {deleteTarget?.knowledgeDocumentId
                ? " and its indexed knowledge document"
                : ""}
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(actionId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(actionId)}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {actionId === deleteTarget?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPage>
  );
}
