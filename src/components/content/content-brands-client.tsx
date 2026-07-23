"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { can } from "@/lib/permissions/can";
import { cn } from "@/lib/utils";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import {
  CONTENT_BRAND_KIND_LABELS,
  CONTENT_FORMAT_LABELS,
  CONTENT_OUTCOME_LABELS,
  CONTENT_PLATFORM_LABELS,
  CONTENT_RESPONSIBILITY_KEYS,
  CONTENT_RESPONSIBILITY_LABELS,
  CONTENT_STRATEGY_LABELS,
  type ContentBrand,
  type ContentBrandKind,
  type ContentFormat,
  type ContentPlatform,
  type ContentPrimaryOutcome,
  type ContentResponsibilityKey,
  type ContentStrategyStyle,
} from "@/lib/content-calendar/types";
import { CONTENT_STRATEGY_PACKS } from "@/lib/content-calendar/strategy-packs";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { OrganizationMember } from "@/lib/types";
import { UserChip } from "@/components/common/user-chip";

const ALL_PLATFORMS = Object.keys(CONTENT_PLATFORM_LABELS) as ContentPlatform[];
const ALL_KINDS = Object.keys(CONTENT_BRAND_KIND_LABELS) as ContentBrandKind[];
const ALL_OUTCOMES = Object.keys(CONTENT_OUTCOME_LABELS) as ContentPrimaryOutcome[];
const ALL_STRATEGIES = Object.keys(CONTENT_STRATEGY_LABELS) as ContentStrategyStyle[];
const ALL_FORMATS = Object.keys(CONTENT_FORMAT_LABELS) as ContentFormat[];

const FORM_STEPS = [
  {
    id: "basics",
    label: "Basics",
    description: "Who this brand is and where it publishes.",
  },
  {
    id: "voice",
    label: "Voice",
    description: "Audience, positioning, and how it should sound.",
  },
  {
    id: "team",
    label: "Team",
    description: "Who plans, writes, designs, posts, and captures.",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    description: "Proof, CTAs, and knowledge libraries for drafts.",
  },
] as const;

type FormStepId = (typeof FORM_STEPS)[number]["id"];

type LibraryOption = { id: string; name: string };

type BrandFormState = {
  name: string;
  kind: ContentBrandKind;
  primaryOutcome: ContentPrimaryOutcome;
  contentStrategy: ContentStrategyStyle;
  platforms: ContentPlatform[];
  positioning: string;
  voiceRules: string;
  targetAudience: string;
  offersToPromote: string;
  topicsToAvoid: string;
  referenceCreators: string;
  proofSources: string;
  preferredCtas: string;
  defaultFormats: ContentFormat[];
  approvalRequired: boolean;
  weeklyPublishTarget: string;
  knowledgeLibraryIds: string[];
  responsibilities: Partial<Record<ContentResponsibilityKey, string>>;
};

const EMPTY_FORM: BrandFormState = {
  name: "",
  kind: "company",
  primaryOutcome: "authority_inbound",
  contentStrategy: "case_studies",
  platforms: ["linkedin", "x"],
  positioning: "",
  voiceRules: "",
  targetAudience: "",
  offersToPromote: "",
  topicsToAvoid: "",
  referenceCreators: "",
  proofSources: "",
  preferredCtas: "",
  defaultFormats: ["text_post", "graphic_post"],
  approvalRequired: true,
  weeklyPublishTarget: "5",
  knowledgeLibraryIds: [],
  responsibilities: {},
};

function formFromBrand(brand: ContentBrand): BrandFormState {
  return {
    name: brand.name,
    kind: brand.kind,
    primaryOutcome: brand.primaryOutcome,
    contentStrategy: brand.contentStrategy,
    platforms: [...brand.platforms],
    positioning: brand.positioning,
    voiceRules: brand.voiceRules,
    targetAudience: brand.targetAudience,
    offersToPromote: brand.offersToPromote,
    topicsToAvoid: brand.topicsToAvoid.join(", "),
    referenceCreators: brand.referenceCreators,
    proofSources: brand.proofSources,
    preferredCtas: brand.preferredCtas,
    defaultFormats: brand.defaultFormats.length ? [...brand.defaultFormats] : ["text_post"],
    approvalRequired: brand.approvalRequired,
    weeklyPublishTarget: String(brand.cadence.weeklyPublishTarget ?? 5),
    knowledgeLibraryIds: [...brand.knowledgeLibraryIds],
    responsibilities: { ...(brand.responsibilities ?? {}) },
  };
}

function defaultsForKind(kind: ContentBrandKind): Pick<
  BrandFormState,
  "primaryOutcome" | "contentStrategy" | "approvalRequired"
> {
  if (kind === "founder") {
    return {
      primaryOutcome: "authority_inbound",
      contentStrategy: "build_in_public",
      approvalRequired: false,
    };
  }
  if (kind === "product") {
    return {
      primaryOutcome: "product_awareness",
      contentStrategy: "educational",
      approvalRequired: true,
    };
  }
  return {
    primaryOutcome: "authority_inbound",
    contentStrategy: "case_studies",
    approvalRequired: true,
  };
}

export function ContentBrandsClient() {
  const navAccess = useNavAccessContext();
  const ws = useWorkspace();
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
  const canEdit = can(permissionSubject, "content_calendar", "edit");
  const canDelete = can(permissionSubject, "content_calendar", "delete");

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingBrand, setEditingBrand] = React.useState<ContentBrand | null>(null);
  const [form, setForm] = React.useState<BrandFormState>(EMPTY_FORM);
  const [formStep, setFormStep] = React.useState<FormStepId>("basics");
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [brandToDelete, setBrandToDelete] = React.useState<ContentBrand | null>(null);
  const [libraries, setLibraries] = React.useState<LibraryOption[]>([]);
  const [libQuery, setLibQuery] = React.useState("");
  const [members, setMembers] = React.useState<{ uid: string; label: string }[]>([]);

  const isEditing = Boolean(editingBrand);
  const stepIndex = FORM_STEPS.findIndex((s) => s.id === formStep);
  const currentStepMeta = FORM_STEPS[stepIndex] ?? FORM_STEPS[0];
  const isLastStep = stepIndex >= FORM_STEPS.length - 1;

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/ai/rag/libraries", { credentials: "same-origin" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          libraries?: { id: string; name?: string }[];
        };
        setLibraries(
          (json.libraries ?? []).map((l) => ({
            id: l.id,
            name: l.name?.trim() || l.id,
          })),
        );
      } catch {
        /* optional - form still works without libraries */
      }
    })();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/org/members", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { members?: OrganizationMember[] };
        const list = (json.members ?? [])
          .filter((m) => m.status === "active")
          .map((m) => ({
            uid: m.uid,
            label: m.displayName?.trim() || m.email?.trim() || m.uid,
          }));
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) {
          setMembers(
            ws.users.map((u) => ({
              uid: u.id,
              label: u.displayName?.trim() || u.email?.trim() || u.id,
            })),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ws.users]);

  const filteredLibraries = React.useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    if (!q) return libraries;
    return libraries.filter(
      (l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q),
    );
  }, [libraries, libQuery]);

  function openCreate() {
    setEditingBrand(null);
    setForm({ ...EMPTY_FORM, ...defaultsForKind("company") });
    setFormStep("basics");
    setLibQuery("");
    setFormOpen(true);
  }

  function openEdit(brand: ContentBrand) {
    setEditingBrand(brand);
    setForm(formFromBrand(brand));
    setFormStep("basics");
    setLibQuery("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingBrand(null);
    setForm(EMPTY_FORM);
    setFormStep("basics");
  }

  function validateBasics(): boolean {
    if (!form.name.trim()) {
      toast.error("Name is required");
      setFormStep("basics");
      return false;
    }
    if (form.platforms.length === 0) {
      toast.error("Pick at least one platform");
      setFormStep("basics");
      return false;
    }
    return true;
  }

  function goNextStep() {
    if (formStep === "basics" && !validateBasics()) return;
    const next = FORM_STEPS[stepIndex + 1];
    if (next) setFormStep(next.id);
  }

  function goPrevStep() {
    const prev = FORM_STEPS[stepIndex - 1];
    if (prev) setFormStep(prev.id);
  }

  function setKind(kind: ContentBrandKind) {
    setForm((prev) => ({ ...prev, kind, ...defaultsForKind(kind) }));
  }

  function togglePlatform(p: ContentPlatform) {
    setForm((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter((x) => x !== p)
        : [...prev.platforms, p],
    }));
  }

  function toggleFormat(f: ContentFormat) {
    setForm((prev) => ({
      ...prev,
      defaultFormats: prev.defaultFormats.includes(f)
        ? prev.defaultFormats.filter((x) => x !== f)
        : [...prev.defaultFormats, f],
    }));
  }

  function toggleLibrary(id: string) {
    setForm((prev) => ({
      ...prev,
      knowledgeLibraryIds: prev.knowledgeLibraryIds.includes(id)
        ? prev.knowledgeLibraryIds.filter((x) => x !== id)
        : [...prev.knowledgeLibraryIds, id],
    }));
  }

  async function saveBrand() {
    if (!validateBasics()) return;
    setSaving(true);
    try {
      const topicsToAvoid = form.topicsToAvoid
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const weeklyPublishTarget = Number(form.weeklyPublishTarget) || undefined;
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        primaryOutcome: form.primaryOutcome,
        contentStrategy: form.contentStrategy,
        platforms: form.platforms,
        positioning: form.positioning.trim(),
        voiceRules: form.voiceRules.trim(),
        targetAudience: form.targetAudience.trim(),
        offersToPromote: form.offersToPromote.trim(),
        topicsToAvoid,
        referenceCreators: form.referenceCreators.trim(),
        proofSources: form.proofSources.trim(),
        preferredCtas: form.preferredCtas.trim(),
        defaultFormats: form.defaultFormats,
        approvalRequired: form.approvalRequired,
        knowledgeLibraryIds: form.knowledgeLibraryIds,
        weeklyPublishTarget,
        responsibilities: form.responsibilities,
      };

      if (editingBrand) {
        await data.updateBrand(editingBrand.id, {
          ...payload,
          goal: form.primaryOutcome,
          cadence: {
            ...editingBrand.cadence,
            weeklyPublishTarget,
          },
        });
      } else {
        await data.createBrand({
          ...payload,
          positioning: form.positioning.trim() || undefined,
          voiceRules: form.voiceRules.trim() || undefined,
          strategyPackId: "b2b_agency_v1",
        });
      }
      closeForm();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : isEditing
            ? "Could not update brand"
            : "Could not create brand",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteBrand() {
    if (!brandToDelete) return;
    setDeleting(true);
    try {
      await data.deleteBrand(brandToDelete.id);
      setBrandToDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete brand");
    } finally {
      setDeleting(false);
    }
  }

  const libraryName = (id: string) => libraries.find((l) => l.id === id)?.name ?? id;

  return (
    <AppPage>
      <PageHeader
        title="Content brands"
        description="Separate brand type, outcome, and strategy - with voice, pillars, proof sources, and cadence."
        actions={
          <>
            <Link
              href="/content"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Back to calendar
            </Link>
            {canCreate && (
              <Button size="sm" type="button" onClick={openCreate}>
                New brand
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        <div className="grid gap-4 md:grid-cols-2">
          {data.brands.map((brand) => (
            <Card key={brand.id} className={!brand.active ? "opacity-60" : undefined}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>{brand.name}</span>
                  <Badge variant="secondary">
                    {CONTENT_BRAND_KIND_LABELS[brand.kind] ?? brand.kind}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {CONTENT_OUTCOME_LABELS[brand.primaryOutcome]} ·{" "}
                  {CONTENT_STRATEGY_LABELS[brand.contentStrategy]} ·{" "}
                  {CONTENT_STRATEGY_PACKS[brand.strategyPackId]?.name ?? brand.strategyPackId}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1">
                  {brand.platforms.map((p) => (
                    <Badge key={p} variant="outline">
                      {CONTENT_PLATFORM_LABELS[p]}
                    </Badge>
                  ))}
                </div>
                <p className="text-muted-foreground line-clamp-3">{brand.positioning}</p>
                {brand.targetAudience ? (
                  <div className="text-xs text-muted-foreground">
                    Audience: {brand.targetAudience}
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  Pillars:{" "}
                  {brand.pillars
                    .filter((p) => p.enabled)
                    .map((p) => `${p.name} ${p.targetPercent}%`)
                    .join(" · ")}
                </div>
                <div className="text-xs text-muted-foreground">
                  Knowledge:{" "}
                  {brand.knowledgeLibraryIds.length
                    ? brand.knowledgeLibraryIds.map(libraryName).join(", ")
                    : "Org default (Fit Check global)"}
                </div>
                {brand.responsibilities &&
                Object.values(brand.responsibilities).some((id) => Boolean(id?.trim())) ? (
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {(Object.entries(brand.responsibilities) as [ContentResponsibilityKey, string][])
                      .filter(([, uid]) => Boolean(uid?.trim()))
                      .map(([key, uid]) => (
                        <span key={key} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5">
                          {CONTENT_RESPONSIBILITY_LABELS[key]}
                          <UserChip userId={uid} size="xs" />
                        </span>
                      ))}
                  </div>
                ) : null}
                {(canEdit || canDelete) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {canEdit && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => openEdit(brand)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() =>
                            void data.updateBrand(brand.id, { active: !brand.active })
                          }
                        >
                          {brand.active ? "Deactivate" : "Activate"}
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setBrandToDelete(brand)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <AlertDialog
          open={Boolean(brandToDelete)}
          onOpenChange={(open) => {
            if (!open && !deleting) setBrandToDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete brand?</AlertDialogTitle>
              <AlertDialogDescription>
                {brandToDelete
                  ? `“${brandToDelete.name}” will be permanently removed. Existing calendar items for this brand are not deleted.`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault();
                  void confirmDeleteBrand();
                }}
              >
                {deleting ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            if (!open) closeForm();
            else setFormOpen(true);
          }}
        >
          <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <div className="shrink-0 space-y-4 border-b px-4 pt-4 pb-3 sm:px-6">
              <DialogHeader className="pr-8 text-left">
                <DialogTitle>{isEditing ? "Edit brand" : "New brand"}</DialogTitle>
                <DialogDescription>{currentStepMeta.description}</DialogDescription>
              </DialogHeader>
              <nav aria-label="Brand setup steps" className="flex gap-1">
                {FORM_STEPS.map((step, i) => {
                  const active = step.id === formStep;
                  const reached = i <= stepIndex;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => {
                        if (i > 0 && !validateBasics()) return;
                        setFormStep(step.id);
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-2 py-1.5 text-left transition-colors",
                        active ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
                            active
                              ? "bg-primary text-primary-foreground"
                              : reached
                                ? "bg-primary/20 text-primary"
                                : "bg-muted-foreground/15 text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={cn(
                            "truncate text-xs font-medium",
                            active ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {step.label}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "h-0.5 rounded-full",
                          reached ? "bg-primary" : "bg-border",
                        )}
                      />
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {formStep === "basics" ? (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="brand-name">Name</Label>
                      <Input
                        id="brand-name"
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Company or founder name"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Brand type</Label>
                      <Select
                        value={form.kind}
                        onValueChange={(v) => {
                          if (v) setKind(v as ContentBrandKind);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {CONTENT_BRAND_KIND_LABELS[form.kind]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_KINDS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {CONTENT_BRAND_KIND_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Primary outcome</Label>
                      <Select
                        value={form.primaryOutcome}
                        onValueChange={(v) => {
                          if (v)
                            setForm((prev) => ({
                              ...prev,
                              primaryOutcome: v as ContentPrimaryOutcome,
                            }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {CONTENT_OUTCOME_LABELS[form.primaryOutcome]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_OUTCOMES.map((g) => (
                            <SelectItem key={g} value={g}>
                              {CONTENT_OUTCOME_LABELS[g]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Content strategy</Label>
                      <Select
                        value={form.contentStrategy}
                        onValueChange={(v) => {
                          if (v)
                            setForm((prev) => ({
                              ...prev,
                              contentStrategy: v as ContentStrategyStyle,
                            }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {CONTENT_STRATEGY_LABELS[form.contentStrategy]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_STRATEGIES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {CONTENT_STRATEGY_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Platforms</Label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_PLATFORMS.map((p) => {
                        const on = form.platforms.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePlatform(p)}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                              on
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted/50",
                            )}
                          >
                            {CONTENT_PLATFORM_LABELS[p]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Default formats</Label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_FORMATS.map((f) => {
                        const on = form.defaultFormats.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleFormat(f)}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                              on
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted/50",
                            )}
                          >
                            {CONTENT_FORMAT_LABELS[f]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="brand-weekly">Weekly publishing target</Label>
                      <Input
                        id="brand-weekly"
                        type="number"
                        min={1}
                        max={30}
                        value={form.weeklyPublishTarget}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, weeklyPublishTarget: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.approvalRequired}
                          onCheckedChange={(c) =>
                            setForm((prev) => ({ ...prev, approvalRequired: c === true }))
                          }
                        />
                        Approval required before publish
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              {formStep === "voice" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="brand-audience">Target audience</Label>
                    <Textarea
                      id="brand-audience"
                      value={form.targetAudience}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, targetAudience: e.target.value }))
                      }
                      rows={2}
                      placeholder="Who should this content reach?"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-offers">Services or offers to promote</Label>
                    <Textarea
                      id="brand-offers"
                      value={form.offersToPromote}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, offersToPromote: e.target.value }))
                      }
                      rows={2}
                      placeholder="What can soft CTAs point to?"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-positioning">Positioning</Label>
                    <Textarea
                      id="brand-positioning"
                      value={form.positioning}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, positioning: e.target.value }))
                      }
                      rows={4}
                      placeholder="Paste positioning here"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-voice">Voice rules</Label>
                    <Textarea
                      id="brand-voice"
                      value={form.voiceRules}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, voiceRules: e.target.value }))
                      }
                      rows={4}
                      placeholder="Tone, phrasing, what to avoid in voice…"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="brand-avoid">Topics to avoid</Label>
                      <Input
                        id="brand-avoid"
                        value={form.topicsToAvoid}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, topicsToAvoid: e.target.value }))
                        }
                        placeholder="Politics, pricing rumors, …"
                      />
                      <p className="text-xs text-muted-foreground">Comma-separated</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="brand-refs">Reference creators</Label>
                      <Input
                        id="brand-refs"
                        value={form.referenceCreators}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, referenceCreators: e.target.value }))
                        }
                        placeholder="Accounts or creators to learn from"
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {formStep === "team" ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Assign people to each role for this brand. Leave empty to use the brand owner.
                    One person can hold every slot, or split across the team.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {CONTENT_RESPONSIBILITY_KEYS.map((key) => {
                      const value = form.responsibilities[key] ?? "";
                      return (
                        <div key={key} className="space-y-2">
                          <Label>{CONTENT_RESPONSIBILITY_LABELS[key]}</Label>
                          <Select
                            value={value || "__owner__"}
                            onValueChange={(v) => {
                              setForm((prev) => {
                                const next = { ...prev.responsibilities };
                                if (!v || v === "__owner__") delete next[key];
                                else next[key] = v;
                                return { ...prev, responsibilities: next };
                              });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Brand owner (default)">
                                {value ? (
                                  <span className="flex items-center gap-2 truncate">
                                    <UserChip userId={value} size="sm" />
                                  </span>
                                ) : (
                                  "Brand owner (default)"
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__owner__">Brand owner (default)</SelectItem>
                              {members.map((m) => (
                                <SelectItem key={m.uid} value={m.uid}>
                                  {m.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {formStep === "knowledge" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="brand-proof">Proof sources</Label>
                    <Textarea
                      id="brand-proof"
                      value={form.proofSources}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, proofSources: e.target.value }))
                      }
                      rows={3}
                      placeholder="Case studies, project docs, founder notes, client-approved metrics…"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-ctas">Preferred calls to action</Label>
                    <Input
                      id="brand-ctas"
                      value={form.preferredCtas}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, preferredCtas: e.target.value }))
                      }
                      placeholder="Book a Fit Check, reply with niche, soft DM…"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Knowledge sources</Label>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to use the org default (Fit Check global).
                    </p>
                    <Input
                      value={libQuery}
                      onChange={(e) => setLibQuery(e.target.value)}
                      placeholder="Search knowledge libraries…"
                    />
                    <div className="max-h-44 overflow-y-auto rounded-md border p-2 space-y-1">
                      {filteredLibraries.length === 0 ? (
                        <p className="px-1 py-2 text-xs text-muted-foreground">
                          No libraries found. Seed knowledge under AI &amp; knowledge, or leave
                          empty for the org default.
                        </p>
                      ) : (
                        filteredLibraries.map((l) => (
                          <label
                            key={l.id}
                            className="flex items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={form.knowledgeLibraryIds.includes(l.id)}
                              onCheckedChange={() => toggleLibrary(l.id)}
                            />
                            <span className="min-w-0 truncate">{l.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {form.knowledgeLibraryIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {form.knowledgeLibraryIds.map((id) => (
                          <Badge key={id} variant="secondary" className="text-[10px]">
                            {libraryName(id)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <DialogFooter className="mx-0 mb-0 shrink-0 gap-2 rounded-none border-t bg-transparent px-4 py-3 sm:justify-between sm:px-6">
              <Button type="button" variant="ghost" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {stepIndex > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goPrevStep}
                    disabled={saving}
                  >
                    Back
                  </Button>
                ) : null}
                {!isLastStep ? (
                  <Button type="button" onClick={goNextStep} disabled={saving}>
                    Continue
                  </Button>
                ) : null}
                {isLastStep || isEditing ? (
                  <Button type="button" onClick={() => void saveBrand()} disabled={saving}>
                    {saving ? "Saving…" : isEditing ? "Save changes" : "Create brand"}
                  </Button>
                ) : null}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </AppPage>
  );
}
