"use client";

import * as React from "react";
import Link from "next/link";
import {
  Loader2,
  Sparkles,
  Globe,
  Link2,
  Link2Off,
  FileText,
  Trash2,
  Pencil,
  BookOpen,
  ChevronDown,
  Library,
  CheckCircle2,
  Circle,
  ExternalLink,
} from "lucide-react";
import { FitKnowledgeDocumentsSheet } from "@/components/admin/fit-knowledge-documents-sheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { toast } from "sonner";
import {
  OPPORTUNITY_SOURCE_LABELS,
  OPPORTUNITY_SOURCE_TYPES,
  type FitCheckCategoryKnowledgeConfig,
  type FitCheckKnowledgeConfig,
} from "@/lib/ai/fit-check-knowledge-types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type { RagVectorHealth } from "@/lib/ai/rag-vector-health";
import {
  ALL_LIBRARY_FEATURES,
  defaultAllowedFeaturesForLibraryType,
  displayKnowledgeLibraryName,
  KNOWLEDGE_CONSUMER_LABELS,
  KNOWLEDGE_TYPE_LABELS,
  knowledgeTypeBadgeVariant,
  resolveAllowedFeatures,
  resolveKnowledgeLibraryType,
  type KnowledgeLibraryUiType,
} from "@/lib/ai/knowledge-library-ui";
import type { AiLibraryAllowedFeature } from "@/lib/ai/types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { getClientDb } from "@/lib/db/document-access/client";
import { COLLECTIONS } from "@/lib/documents/collections";
import { collection, getDocs, query, where } from "@/lib/db/document-shim/shim-client-firestore";
import { cn } from "@/lib/utils";

type LibraryRow = {
  id: string;
  name: string;
  libraryKind?: string;
  fitCategory?: string;
  documentCount?: number;
  chunkCount?: number;
  lastIndexedAt?: string;
  scope?: { type?: string; brandId?: string };
  description?: string;
  allowedFeatures?: AiLibraryAllowedFeature[];
};

function AllowedForChips({ lib }: { lib: LibraryRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {resolveAllowedFeatures(lib).map((id) => (
        <Badge key={id} variant="outline" className="text-[10px] font-normal">
          {KNOWLEDGE_CONSUMER_LABELS[id]}
        </Badge>
      ))}
    </div>
  );
}

export function KnowledgeAdminPanel({
  mode,
  aiEnabled,
  libraries: externalLibraries,
  onLibrariesChange,
  onSeeded,
}: {
  mode: "overview" | "libraries";
  aiEnabled: boolean;
  libraries?: LibraryRow[];
  onLibrariesChange?: () => void;
  onSeeded?: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [seedingCategory, setSeedingCategory] = React.useState<OpportunitySourceType | null>(null);
  const [config, setConfig] = React.useState<FitCheckKnowledgeConfig | null>(null);
  const [libraries, setLibraries] = React.useState<LibraryRow[]>(externalLibraries ?? []);
  const [vectorHealth, setVectorHealth] = React.useState<RagVectorHealth | null>(null);
  const [docSheet, setDocSheet] = React.useState<{ libraryId: string; label: string } | null>(
    null,
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [fitConsumerOpen, setFitConsumerOpen] = React.useState(false);
  const [newLibName, setNewLibName] = React.useState("");
  const [newLibDescription, setNewLibDescription] = React.useState("");
  const [newLibType, setNewLibType] = React.useState<KnowledgeLibraryUiType>("topic");
  const [newLibBrandId, setNewLibBrandId] = React.useState("");
  const [newLibFitCategory, setNewLibFitCategory] = React.useState<OpportunitySourceType | "">(
    OPPORTUNITY_SOURCE_TYPES[0] ?? "",
  );
  const [creatingLib, setCreatingLib] = React.useState(false);
  const [docTitle, setDocTitle] = React.useState("");
  const [docContent, setDocContent] = React.useState("");
  const [selectedLib, setSelectedLib] = React.useState("");
  const [editLib, setEditLib] = React.useState<LibraryRow | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editFeatures, setEditFeatures] = React.useState<AiLibraryAllowedFeature[]>([]);
  const [editType, setEditType] = React.useState<KnowledgeLibraryUiType>("topic");
  const [editBrandId, setEditBrandId] = React.useState("");
  const [editFitCategory, setEditFitCategory] = React.useState<OpportunitySourceType | "">(
    "",
  );
  const [brandOptions, setBrandOptions] = React.useState<{ id: string; name: string }[]>([]);
  const [editSaving, setEditSaving] = React.useState(false);
  const [deleteLib, setDeleteLib] = React.useState<LibraryRow | null>(null);
  const [deletingLib, setDeletingLib] = React.useState(false);
  const ws = useWorkspace();

  const loadFit = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/rag/fit-knowledge", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        config: FitCheckKnowledgeConfig;
        libraries: LibraryRow[];
        vectorHealth?: RagVectorHealth;
      };
      setConfig(data.config);
      setVectorHealth(data.vectorHealth ?? null);
      if (!externalLibraries) {
        setLibraries(data.libraries ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [externalLibraries]);

  React.useEffect(() => {
    void loadFit();
  }, [loadFit]);

  React.useEffect(() => {
    if (!externalLibraries) return;
    setLibraries(externalLibraries);
  }, [externalLibraries]);

  React.useEffect(() => {
    if (!selectedLib && libraries[0]) {
      setSelectedLib(libraries[0].id);
    }
  }, [libraries, selectedLib]);

  React.useEffect(() => {
    const needBrands = Boolean(editLib) || newLibType === "brand";
    if (!needBrands || !ws.organizationId) return;
    let cancelled = false;
    void (async () => {
      const db = getClientDb();
      if (!db) return;
      try {
        const snap = await getDocs(
          query(
            collection(db, COLLECTIONS.contentBrands),
            where("organizationId", "==", ws.organizationId),
          ),
        );
        if (cancelled) return;
        setBrandOptions(
          snap.docs
            .map((d) => ({
              id: d.id,
              name: String((d.data() as { name?: string }).name ?? d.id),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (!cancelled) setBrandOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editLib, newLibType, ws.organizationId]);

  async function saveConfig(patch: {
    globalEnabled?: boolean;
    retrievalBudget?: FitCheckKnowledgeConfig["retrievalBudget"];
    categories?: Partial<Record<OpportunitySourceType, Partial<FitCheckCategoryKnowledgeConfig>>>;
  }) {
    setSaving(true);
    try {
      const res = await fetch("/api/ai/rag/fit-knowledge", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save");
        return;
      }
      setConfig(data.config);
    } finally {
      setSaving(false);
    }
  }

  async function seedAll() {
    setSeeding(true);
    try {
      const res = await fetch("/api/ai/rag/seed-fit-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rescrape: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Index failed");
        return;
      }
      toast.success(
        `Indexed company knowledge + channel packs · ${data.documentsCreated ?? 0} docs · ${data.chunksIndexed ?? 0} chunks`,
      );
      await loadFit();
      onSeeded?.();
      onLibrariesChange?.();
    } catch {
      toast.error("Network error");
    } finally {
      setSeeding(false);
    }
  }

  async function seedOneCategory(cat: OpportunitySourceType) {
    setSeedingCategory(cat);
    try {
      const res = await fetch("/api/ai/rag/seed-fit-category", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, rescrape: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Seed failed");
        return { ok: false as const };
      }
      await loadFit();
      onLibrariesChange?.();
      return { ok: true as const, libraryId: String(data.categoryLibraryId ?? "") };
    } catch {
      toast.error("Network error");
      return { ok: false as const };
    } finally {
      setSeedingCategory(null);
    }
  }

  async function deleteCategoryLibrary(libraryId: string, cat: OpportunitySourceType) {
    const ok = confirm(
      `Delete channel pack "${OPPORTUNITY_SOURCE_LABELS[cat]}"?\nThis removes its documents and hides it from Fit Check retrieval.`,
    );
    if (!ok) return;

    const res = await fetch(`/api/ai/rag/libraries/${encodeURIComponent(libraryId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not delete");
      return;
    }

    toast.success("Channel pack deleted");
    setLibraries((prev) => prev.filter((l) => l.id !== libraryId));
    await loadFit();
    onLibrariesChange?.();
  }

  function openLibraryView(lib: LibraryRow) {
    setSelectedLib(lib.id);
    setDocSheet({
      libraryId: lib.id,
      label: displayKnowledgeLibraryName(lib),
    });
  }

  async function createLibrary() {
    if (!newLibName.trim()) return;
    if (newLibType === "brand" && !newLibBrandId) {
      toast.error("Pick a brand for this brand pack");
      return;
    }
    if (newLibType === "channel" && !newLibFitCategory) {
      toast.error("Pick a channel for this channel pack");
      return;
    }
    setCreatingLib(true);
    try {
      const res = await fetch("/api/ai/rag/libraries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newLibName.trim(),
          ...(newLibDescription.trim()
            ? { description: newLibDescription.trim() }
            : {}),
          libraryType: newLibType,
          ...(newLibType === "brand" ? { brandId: newLibBrandId } : {}),
          ...(newLibType === "channel" ? { fitCategory: newLibFitCategory } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof data.error === "string"
            ? data.error
            : data.error?.formErrors?.[0] ?? "Could not create library",
        );
        return;
      }
      const created = data.library as LibraryRow | undefined;
      if (created?.id) {
        setLibraries((prev) => [...prev, created]);
        setSelectedLib(created.id);
      }
      toast.success("Library created");
      setNewLibName("");
      setNewLibDescription("");
      setNewLibType("topic");
      setNewLibBrandId("");
      onLibrariesChange?.();
      await loadFit();
    } finally {
      setCreatingLib(false);
    }
  }

  function openEditLibrary(lib: LibraryRow) {
    const type = resolveKnowledgeLibraryType(lib);
    setEditLib(lib);
    setEditName(lib.name ?? "");
    setEditDescription(lib.description ?? "");
    setEditFeatures(resolveAllowedFeatures(lib));
    setEditType(type);
    setEditBrandId(lib.scope?.brandId ?? "");
    setEditFitCategory(
      (lib.fitCategory as OpportunitySourceType | undefined) ??
        OPPORTUNITY_SOURCE_TYPES[0] ??
        "",
    );
    setSelectedLib(lib.id);
  }

  function onEditTypeChange(next: KnowledgeLibraryUiType) {
    setEditType(next);
    // Suggest defaults for the new type if the user hasn't customized away from old defaults.
    setEditFeatures(defaultAllowedFeaturesForLibraryType(next));
  }

  function toggleEditFeature(feature: AiLibraryAllowedFeature) {
    setEditFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature],
    );
  }

  async function saveEditLibrary() {
    if (!editLib || !editName.trim()) {
      toast.error("Name is required");
      return;
    }
    if (editFeatures.length === 0) {
      toast.error("Pick at least one allowed feature");
      return;
    }
    if (editType === "brand" && !editBrandId) {
      toast.error("Pick a brand for this brand pack");
      return;
    }
    if (editType === "channel" && !editFitCategory) {
      toast.error("Pick a channel for this channel pack");
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/ai/rag/libraries/${encodeURIComponent(editLib.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          allowedFeatures: editFeatures,
          libraryType: editType,
          ...(editType === "brand" ? { brandId: editBrandId } : {}),
          ...(editType === "channel" ? { fitCategory: editFitCategory } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err =
          typeof data.error === "string"
            ? data.error
            : data.error?.formErrors?.[0] ??
              data.error?.fieldErrors?.brandId?.[0] ??
              data.error?.fieldErrors?.fitCategory?.[0] ??
              "Could not update library";
        toast.error(err);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const updated = data.library as LibraryRow | undefined;
      if (updated?.id) {
        setLibraries((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
      }
      toast.success("Library updated");
      setEditLib(null);
      onLibrariesChange?.();
      await loadFit();
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmDeleteLibrary() {
    if (!deleteLib) return;
    const removedId = deleteLib.id;
    setDeletingLib(true);
    try {
      const res = await fetch(`/api/ai/rag/libraries/${encodeURIComponent(removedId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Could not delete library");
        return;
      }
      setLibraries((prev) => prev.filter((l) => l.id !== removedId));
      if (selectedLib === removedId) setSelectedLib("");
      setDeleteLib(null);
      toast.success("Library deleted");
      onLibrariesChange?.();
      await loadFit();
    } finally {
      setDeletingLib(false);
    }
  }

  function canDeleteLibrary(lib: LibraryRow) {
    return resolveKnowledgeLibraryType(lib) !== "company";
  }

  async function uploadDoc() {
    if (!selectedLib || !docTitle.trim() || !docContent.trim()) return;
    const res = await fetch("/api/ai/rag/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryId: selectedLib,
        title: docTitle.trim(),
        content: docContent.trim(),
        indexNow: true,
      }),
    });
    if (!res.ok) toast.error("Could not add document");
    else {
      toast.success("Document indexed");
      setDocTitle("");
      setDocContent("");
      onLibrariesChange?.();
      await loadFit();
    }
  }

  const companyLib = libraries.find((l) => {
    const t = resolveKnowledgeLibraryType(l);
    return t === "company";
  });
  const selectedLibRow = libraries.find((l) => l.id === selectedLib) ?? null;

  const typedLibraries = React.useMemo(() => {
    const groups: Record<KnowledgeLibraryUiType, LibraryRow[]> = {
      company: [],
      brand: [],
      channel: [],
      topic: [],
    };
    for (const lib of libraries) {
      groups[resolveKnowledgeLibraryType(lib)].push(lib);
    }
    return groups;
  }, [libraries]);

  const docCount = libraries.reduce((n, l) => n + (l.documentCount ?? 0), 0);
  const chunkCount = libraries.reduce((n, l) => n + (l.chunkCount ?? 0), 0);

  if (loading && !config && mode === "overview") {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading knowledge…
      </p>
    );
  }

  const budget = config?.retrievalBudget ?? { globalChunks: 5, categoryChunks: 4 };

  const readiness = [
    {
      ok: aiEnabled,
      label: "Platform AI enabled",
      href: "/admin/ai?tab=setup",
    },
    {
      ok: Boolean(companyLib && (companyLib.chunkCount ?? 0) > 0),
      label: "Company knowledge indexed",
      href: "/admin/ai?tab=libraries",
    },
    {
      ok: typedLibraries.brand.length > 0 || typedLibraries.topic.length > 0,
      label: "Brand or topic library for Content / Capture",
      href: "/admin/ai?tab=brands",
    },
    {
      ok: vectorHealth?.status === "active" || chunkCount > 0,
      label: "Vector search ready",
      href: "/admin/ai?tab=libraries",
    },
  ];

  if (mode === "overview") {
    return (
      <div className="space-y-4">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> Org knowledge base
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Shared knowledge store for Content, email sequences, Fit Check, and other AI. Brands
              pick Content-allowed libraries; outreach profiles pick Fit Check / Email libraries.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={!aiEnabled || seeding} onClick={() => void seedAll()}>
              {seeding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Indexing…
                </>
              ) : (
                "Index / refresh company + channels"
              )}
            </Button>
            <Link
              href="/admin/ai?tab=libraries"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Manage libraries
            </Link>
            <Link
              href="/admin/ai?tab=brands"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Manage brands
            </Link>
            <Link href="/content/capture" className={cn(buttonVariants({ variant: "outline" }))}>
              Open Capture
            </Link>
            {!aiEnabled && (
              <p className="text-xs text-muted-foreground w-full">
                Enable Platform AI on Setup first (embeddings need a key).
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Libraries</p>
              <p className="text-2xl font-semibold tabular-nums">{libraries.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Documents</p>
              <p className="text-2xl font-semibold tabular-nums">{docCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Chunks indexed</p>
              <p className="text-2xl font-semibold tabular-nums">{chunkCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Search</p>
              <p className="text-sm font-medium mt-1">
                {vectorHealth?.label ?? (chunkCount > 0 ? "Indexed" : "Not ready")}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Readiness</CardTitle>
            <CardDescription className="text-xs">
              Checklist so Content and Outreach can ground in knowledge — Fit Check uses the same
              base.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {readiness.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-2 text-sm rounded-md border px-3 py-2 hover:bg-muted/40"
              >
                {item.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className={cn(!item.ok && "text-muted-foreground")}>{item.label}</span>
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Libraries</h3>
          <p className="text-xs text-muted-foreground">
            Knowledge corpora and the features each library is allowed for. Brands link Content
            libraries; profiles link Fit Check / Email libraries.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {libraries.length === 0 ? (
              <Card>
                <CardContent className="pt-4 text-sm text-muted-foreground">
                  No libraries yet. Index company knowledge or create a topic library.
                </CardContent>
              </Card>
            ) : (
              (["company", "topic", "channel", "brand"] as KnowledgeLibraryUiType[]).flatMap(
                (type) =>
                  typedLibraries[type].map((lib) => (
                    <Card key={lib.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-sm leading-snug">
                            {displayKnowledgeLibraryName(lib)}
                          </CardTitle>
                          <Badge
                            variant={knowledgeTypeBadgeVariant(type)}
                            className="text-[10px] shrink-0"
                          >
                            {KNOWLEDGE_TYPE_LABELS[type]}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs">
                          {lib.documentCount ?? 0} docs · {lib.chunkCount ?? 0} chunks
                          {config && type === "company" && !config.globalEnabled
                            ? " · company retrieval off"
                            : ""}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                            Allowed for
                          </p>
                          <AllowedForChips lib={lib} />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() =>
                            setDocSheet({
                              libraryId: lib.id,
                              label: displayKnowledgeLibraryName(lib),
                            })
                          }
                        >
                          <FileText className="h-3 w-3 mr-1" /> View & edit documents
                        </Button>
                      </CardContent>
                    </Card>
                  )),
              )
            )}
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">How knowledge flows</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2 leading-relaxed">
            <p>
              <strong className="text-foreground">Libraries</strong> hold documents. Toggle which
              features may use each library.{" "}
              <strong className="text-foreground">Brands</strong> (Content only) and{" "}
              <strong className="text-foreground">outreach profiles</strong> choose which allowed
              libraries to read.
            </p>
            <p>
              <strong className="text-foreground">Company knowledge</strong> is the shared default.
              Channel packs are mainly for Fit Check.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href="/admin/ai?tab=brands"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
              >
                Brands
              </Link>
              <Link
                href="/admin/profiles"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
              >
                Outreach profiles
              </Link>
              <Link
                href="/fit-check"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
              >
                Fit Check
              </Link>
            </div>
          </CardContent>
        </Card>

        <FitKnowledgeDocumentsSheet
          open={docSheet != null}
          onOpenChange={(open) => !open && setDocSheet(null)}
          libraryId={docSheet?.libraryId ?? null}
          libraryLabel={docSheet?.label ?? ""}
          onChanged={() => {
            void loadFit();
            onLibrariesChange?.();
          }}
        />
      </div>
    );
  }

  // ── Libraries mode ──────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4" /> Company knowledge
          </CardTitle>
          <CardDescription className="text-xs">
            Org-wide corpus (site, ICP, services, case studies). Toggle allowed features below in
            All libraries; brands and profiles link what they need.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {config ? (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="company-enabled" className="text-sm">
                Company library enabled for retrieval
              </Label>
              <Switch
                id="company-enabled"
                checked={config.globalEnabled}
                disabled={saving}
                onCheckedChange={(v) => void saveConfig({ globalEnabled: !!v })}
              />
            </div>
          ) : null}
          {companyLib ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {companyLib.documentCount ?? 0} documents · {companyLib.chunkCount ?? 0} chunks
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    setDocSheet({
                      libraryId: companyLib.id,
                      label: displayKnowledgeLibraryName(companyLib),
                    })
                  }
                >
                  <FileText className="h-3 w-3 mr-1" /> View & edit documents
                </Button>
              </div>
              <AllowedForChips lib={companyLib} />
              {vectorHealth && (
                <div className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-2">
                  <span className="text-xs text-muted-foreground shrink-0 pt-0.5">Vector search</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-medium",
                      vectorHealth.status === "active" &&
                        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                      vectorHealth.status === "fallback" &&
                        "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                      vectorHealth.status === "not_indexed" &&
                        "border-muted-foreground/30 text-muted-foreground",
                    )}
                  >
                    {vectorHealth.label}
                  </Badge>
                  <p className="text-[11px] leading-snug text-muted-foreground min-w-0 flex-1">
                    {vectorHealth.detail}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Not indexed yet — run Index from Overview.
              </p>
              <Button type="button" size="sm" disabled={!aiEnabled || seeding} onClick={() => void seedAll()}>
                {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Index company knowledge
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Library className="h-4 w-4" /> All libraries
          </CardTitle>
          <CardDescription className="text-xs">
            Shared knowledge packs. Edit a library to set name, intro (what it is for), and which
            features may use it — then link on Brands (Content) or outreach profiles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="text-sm space-y-1.5">
            {libraries.map((l) => {
              const type = resolveKnowledgeLibraryType(l);
              const deletable = canDeleteLibrary(l);
              const intro = l.description?.trim();
              return (
                <li key={l.id} className="flex items-start gap-1.5">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className={cn(
                        "text-left w-full truncate hover:underline",
                        selectedLib === l.id && "font-semibold",
                      )}
                      onClick={() => setSelectedLib(l.id)}
                    >
                      {displayKnowledgeLibraryName(l)}
                    </button>
                    {intro ? (
                      <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                        {intro}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant={knowledgeTypeBadgeVariant(type)}
                    className="text-[9px] shrink-0 mt-0.5"
                  >
                    {KNOWLEDGE_TYPE_LABELS[type]}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 mt-0.5">
                    {l.documentCount ?? 0} docs
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px] shrink-0 mt-0.5"
                    title="Edit library"
                    onClick={() => openEditLibrary(l)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px] text-destructive disabled:opacity-40 shrink-0 mt-0.5"
                    title={
                      deletable
                        ? "Delete library"
                        : "Company knowledge cannot be deleted"
                    }
                    disabled={!deletable}
                    onClick={() => setDeleteLib(l)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] shrink-0 mt-0.5"
                    title="View library documents"
                    onClick={() => openLibraryView(l)}
                  >
                    <FileText className="h-3 w-3 mr-1" />
                    View
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium">Add library</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-lib-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="new-lib-name"
                  placeholder="e.g. Nova, Services, Stellix Soft…"
                  value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-lib-intro" className="text-xs">
                  Library intro
                </Label>
                <Textarea
                  id="new-lib-intro"
                  className="min-h-[64px]"
                  value={newLibDescription}
                  onChange={(e) => setNewLibDescription(e.target.value)}
                  placeholder="e.g. Nova is Stellix Soft’s sales CRM — built for us and future clients. It solves pipeline, outreach, and knowledge-backed selling."
                  maxLength={500}
                />
                <p className="text-[10px] text-muted-foreground">
                  2–4 sentences on what this pack is for. Content calendar AI uses it as orientation.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={newLibType}
                  onValueChange={(v) => {
                    if (v) setNewLibType(v as KnowledgeLibraryUiType);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KNOWLEDGE_TYPE_LABELS) as KnowledgeLibraryUiType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {KNOWLEDGE_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {newLibType === "brand" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Brand</Label>
                  <Select
                    value={newLibBrandId || undefined}
                    onValueChange={(v) => {
                      if (v) setNewLibBrandId(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select brand…" />
                    </SelectTrigger>
                    <SelectContent>
                      {brandOptions.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {newLibType === "channel" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Channel</Label>
                  <Select
                    value={newLibFitCategory || undefined}
                    onValueChange={(v) => {
                      if (v) setNewLibFitCategory(v as OpportunitySourceType);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select channel…" />
                    </SelectTrigger>
                    <SelectContent>
                      {OPPORTUNITY_SOURCE_TYPES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {OPPORTUNITY_SOURCE_LABELS[cat]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Use <strong className="font-medium text-foreground">Topic</strong> for custom packs
              like Product or Services. Company is the org default (one). Channel and Brand pack need
              a channel or brand.
            </p>
            <Button
              type="button"
              disabled={creatingLib || !newLibName.trim()}
              onClick={() => void createLibrary()}
            >
              {creatingLib ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Add document</CardTitle>
          <CardDescription className="text-xs">
            Upload markdown into the selected library
            {selectedLibRow
              ? ` (${displayKnowledgeLibraryName(selectedLibRow)})`
              : " — click a library name above to select"}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Title"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
          />
          <Textarea
            className="min-h-[160px]"
            placeholder="Markdown content…"
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
          />
          <Button type="button" disabled={!selectedLib} onClick={() => void uploadDoc()}>
            Upload & index
          </Button>
        </CardContent>
      </Card>

      <Collapsible open={fitConsumerOpen} onOpenChange={setFitConsumerOpen}>
        <Card>
          <CardHeader className="pb-2">
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left gap-2"
                >
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4" /> Fit Check retrieval
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Consumer settings only — which channel packs Fit Check pulls, and whether to
                      also include company knowledge. Does not own the knowledge base.
                    </CardDescription>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      fitConsumerOpen && "rotate-180",
                    )}
                  />
                </button>
              }
            />
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-2 pt-0">
              {!config ? (
                <p className="text-xs text-muted-foreground">Loading Fit Check config…</p>
              ) : (
                OPPORTUNITY_SOURCE_TYPES.map((cat) => {
                  const catCfg = config.categories[cat];
                  const lib = libraries.find((l) => l.fitCategory === cat);
                  return (
                    <div
                      key={cat}
                      className={cn(
                        "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-lg border px-3 py-2.5",
                        !catCfg.enabled && "opacity-60",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{OPPORTUNITY_SOURCE_LABELS[cat]}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Channel pack {lib ? `· ${lib.chunkCount ?? 0} chunks` : "· not indexed"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs px-2"
                          disabled={saving || seeding || seedingCategory === cat}
                          onClick={() => {
                            if (lib) {
                              setDocSheet({
                                libraryId: lib.id,
                                label: `Channel · ${OPPORTUNITY_SOURCE_LABELS[cat]}`,
                              });
                              return;
                            }
                            void (async () => {
                              const seeded = await seedOneCategory(cat);
                              if (!seeded.ok || !seeded.libraryId) return;
                              setDocSheet({
                                libraryId: seeded.libraryId,
                                label: `Channel · ${OPPORTUNITY_SOURCE_LABELS[cat]}`,
                              });
                            })();
                          }}
                        >
                          <FileText className="h-3 w-3 mr-1" /> {lib ? "Edit" : "Index & edit"}
                        </Button>
                        {lib ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs px-2"
                            disabled={saving || seeding || seedingCategory != null}
                            onClick={() => void deleteCategoryLibrary(lib.id, cat)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Delete
                          </Button>
                        ) : null}
                        <label className="flex items-center gap-1.5 text-xs">
                          <Switch
                            checked={catCfg.enabled}
                            disabled={saving}
                            onCheckedChange={(v) =>
                              void saveConfig({ categories: { [cat]: { enabled: !!v } } })
                            }
                          />
                          On
                        </label>
                        <label
                          className={cn(
                            "flex items-center gap-1.5 text-xs",
                            (!config.globalEnabled || !catCfg.enabled) && "opacity-40",
                          )}
                          title="Include company knowledge when scoring this channel"
                        >
                          <Switch
                            checked={catCfg.useGlobal}
                            disabled={saving || !config.globalEnabled || !catCfg.enabled}
                            onCheckedChange={(v) =>
                              void saveConfig({ categories: { [cat]: { useGlobal: !!v } } })
                            }
                          />
                          {catCfg.useGlobal ? (
                            <Link2 className="h-3 w-3" />
                          ) : (
                            <Link2Off className="h-3 w-3" />
                          )}
                          Company
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <Card>
          <CardHeader className="pb-2">
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left gap-2"
                >
                  <div>
                    <CardTitle className="text-sm">Advanced · retrieval budget</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Max chunks injected per AI request (org default used by Fit Check and related
                      scoring). Lower = smaller prompts and lower cost.
                    </CardDescription>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      advancedOpen && "rotate-180",
                    )}
                  />
                </button>
              }
            />
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="flex flex-wrap gap-4 pt-0">
              <div className="space-y-1">
                <Label className="text-xs">Company chunks</Label>
                <div className="flex gap-1">
                  {[3, 5, 8].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant={budget.globalChunks === n ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      disabled={saving || !config}
                      onClick={() =>
                        void saveConfig({ retrievalBudget: { ...budget, globalChunks: n } })
                      }
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Channel pack chunks</Label>
                <div className="flex gap-1">
                  {[2, 4, 6].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant={budget.categoryChunks === n ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      disabled={saving || !config}
                      onClick={() =>
                        void saveConfig({ retrievalBudget: { ...budget, categoryChunks: n } })
                      }
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] self-end">
                Total ≤ {budget.globalChunks + budget.categoryChunks} chunks / request
              </Badge>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <FitKnowledgeDocumentsSheet
        open={docSheet != null}
        onOpenChange={(open) => !open && setDocSheet(null)}
        libraryId={docSheet?.libraryId ?? null}
        libraryLabel={docSheet?.label ?? ""}
        onChanged={() => {
          void loadFit();
          onLibrariesChange?.();
        }}
      />

      <Dialog open={!!editLib} onOpenChange={(open) => !open && setEditLib(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit library</DialogTitle>
            <DialogDescription>
              Type, name, intro (what this pack is for), and which product features may link it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={editType}
                onValueChange={(v) => {
                  if (v) onEditTypeChange(v as KnowledgeLibraryUiType);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KNOWLEDGE_TYPE_LABELS) as KnowledgeLibraryUiType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {KNOWLEDGE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Company is the org default corpus. Channel packs are per intake source. Brand packs
                attach to a Content brand. Topic is a shared custom library.
              </p>
            </div>
            {editType === "brand" ? (
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Select
                  value={editBrandId || undefined}
                  onValueChange={(v) => {
                    if (v) setEditBrandId(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select brand…" />
                  </SelectTrigger>
                  <SelectContent>
                    {brandOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {brandOptions.length === 0 ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    No brands yet — create one under the Brands tab first.
                  </p>
                ) : null}
              </div>
            ) : null}
            {editType === "channel" ? (
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select
                  value={editFitCategory || undefined}
                  onValueChange={(v) => {
                    if (v) setEditFitCategory(v as OpportunitySourceType);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select channel…" />
                  </SelectTrigger>
                  <SelectContent>
                    {OPPORTUNITY_SOURCE_TYPES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {OPPORTUNITY_SOURCE_LABELS[cat]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="edit-lib-name">Name</Label>
              <Input
                id="edit-lib-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-lib-desc">Library intro</Label>
              <Textarea
                id="edit-lib-desc"
                className="min-h-[96px]"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="e.g. Nova is Stellix Soft’s sales CRM — built for us and future clients. It solves pipeline, outreach, and knowledge-backed selling."
                maxLength={500}
              />
              <p className="text-[11px] text-muted-foreground">
                Short purpose for this pack (product, service, company, or topic). Content calendar
                AI reads this before retrieved documents.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Allowed features</Label>
              <p className="text-[11px] text-muted-foreground">
                Brands only list Content-allowed libraries. Outreach profiles list Fit Check / Email
                / etc.
              </p>
              <div className="space-y-2 rounded-md border p-2.5">
                {ALL_LIBRARY_FEATURES.map((feature) => {
                  const on = editFeatures.includes(feature);
                  return (
                    <label
                      key={feature}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{KNOWLEDGE_CONSUMER_LABELS[feature]}</span>
                      <Switch
                        checked={on}
                        onCheckedChange={() => toggleEditFeature(feature)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditLib(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEditLibrary()} disabled={editSaving}>
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteLib} onOpenChange={(open) => !open && setDeleteLib(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete library?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLib
                ? `“${displayKnowledgeLibraryName(deleteLib)}” and its documents will be removed. Brands and profiles that linked it will be unlinked.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLib}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingLib}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteLibrary();
              }}
            >
              {deletingLib ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
