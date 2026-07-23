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
  CONTENT_STRATEGY_LABELS,
  type ContentBrand,
  type ContentBrandKind,
  type ContentFormat,
  type ContentPlatform,
  type ContentPrimaryOutcome,
  type ContentStrategyStyle,
} from "@/lib/content-calendar/types";
import { CONTENT_STRATEGY_PACKS } from "@/lib/content-calendar/strategy-packs";

const ALL_PLATFORMS = Object.keys(CONTENT_PLATFORM_LABELS) as ContentPlatform[];
const ALL_KINDS = Object.keys(CONTENT_BRAND_KIND_LABELS) as ContentBrandKind[];
const ALL_OUTCOMES = Object.keys(CONTENT_OUTCOME_LABELS) as ContentPrimaryOutcome[];
const ALL_STRATEGIES = Object.keys(CONTENT_STRATEGY_LABELS) as ContentStrategyStyle[];
const ALL_FORMATS = Object.keys(CONTENT_FORMAT_LABELS) as ContentFormat[];

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
  defaultFormats: ["text_post"],
  approvalRequired: true,
  weeklyPublishTarget: "5",
  knowledgeLibraryIds: [],
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

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingBrand, setEditingBrand] = React.useState<ContentBrand | null>(null);
  const [form, setForm] = React.useState<BrandFormState>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [libraries, setLibraries] = React.useState<LibraryOption[]>([]);
  const [libQuery, setLibQuery] = React.useState("");

  const isEditing = Boolean(editingBrand);

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
        /* optional — form still works without libraries */
      }
    })();
  }, []);

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
    setLibQuery("");
    setFormOpen(true);
  }

  function openEdit(brand: ContentBrand) {
    setEditingBrand(brand);
    setForm(formFromBrand(brand));
    setLibQuery("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingBrand(null);
    setForm(EMPTY_FORM);
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
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (form.platforms.length === 0) {
      toast.error("Pick at least one platform");
      return;
    }
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

  const libraryName = (id: string) => libraries.find((l) => l.id === id)?.name ?? id;

  return (
    <AppPage>
      <PageHeader
        title="Content brands"
        description="Separate brand type, outcome, and strategy — with voice, pillars, proof sources, and cadence."
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
                {canEdit && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" type="button" onClick={() => openEdit(brand)}>
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
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            if (!open) closeForm();
            else setFormOpen(true);
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit brand" : "Brand setup"}</DialogTitle>
              <DialogDescription>
                Brand type, outcome, and strategy are separate. Paste positioning and voice below —
                knowledge sources are selectable, not raw IDs.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Company or founder name"
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
                      <SelectValue />
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
                      <SelectValue />
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
                <div className="space-y-2">
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
                      <SelectValue />
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
                <div className="space-y-2">
                  <Label>Weekly publishing target</Label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={form.weeklyPublishTarget}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, weeklyPublishTarget: e.target.value }))
                    }
                  />
                </div>
                <div className="flex items-end pb-2">
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

              <div className="space-y-2">
                <Label>Platforms</Label>
                <div className="flex flex-wrap gap-3">
                  {ALL_PLATFORMS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.platforms.includes(p)}
                        onCheckedChange={() => togglePlatform(p)}
                      />
                      {CONTENT_PLATFORM_LABELS[p]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Default content formats</Label>
                <div className="flex flex-wrap gap-3">
                  {ALL_FORMATS.map((f) => (
                    <label key={f} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.defaultFormats.includes(f)}
                        onCheckedChange={() => toggleFormat(f)}
                      />
                      {CONTENT_FORMAT_LABELS[f]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Target audience</Label>
                <Textarea
                  value={form.targetAudience}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, targetAudience: e.target.value }))
                  }
                  rows={2}
                  placeholder="Who should this content reach?"
                />
              </div>
              <div className="space-y-2">
                <Label>Services or offers to promote</Label>
                <Textarea
                  value={form.offersToPromote}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, offersToPromote: e.target.value }))
                  }
                  rows={2}
                  placeholder="What can soft CTAs point to?"
                />
              </div>
              <div className="space-y-2">
                <Label>Positioning</Label>
                <Textarea
                  value={form.positioning}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, positioning: e.target.value }))
                  }
                  rows={4}
                  placeholder="Paste positioning here"
                />
              </div>
              <div className="space-y-2">
                <Label>Voice rules</Label>
                <Textarea
                  value={form.voiceRules}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, voiceRules: e.target.value }))
                  }
                  rows={4}
                  placeholder="Paste voice rules here"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Topics to avoid (comma-separated)</Label>
                  <Input
                    value={form.topicsToAvoid}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, topicsToAvoid: e.target.value }))
                    }
                    placeholder="Politics, pricing rumors, …"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Competitors or reference creators</Label>
                  <Input
                    value={form.referenceCreators}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, referenceCreators: e.target.value }))
                    }
                    placeholder="Accounts or creators to learn from"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Proof sources</Label>
                <Textarea
                  value={form.proofSources}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, proofSources: e.target.value }))
                  }
                  rows={2}
                  placeholder="Case studies, project docs, founder notes, client-approved metrics…"
                />
              </div>
              <div className="space-y-2">
                <Label>Preferred calls to action</Label>
                <Input
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
                  Website, case studies, project docs, founder notes, client-approved information.
                </p>
                <Input
                  value={libQuery}
                  onChange={(e) => setLibQuery(e.target.value)}
                  placeholder="Search knowledge libraries…"
                />
                <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                  {filteredLibraries.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">
                      No libraries found. Seed Fit Check knowledge under AI &amp; knowledge, or leave
                      empty to use the org default.
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
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveBrand()} disabled={saving}>
                {saving ? "Saving…" : isEditing ? "Save changes" : "Create brand"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </AppPage>
  );
}
