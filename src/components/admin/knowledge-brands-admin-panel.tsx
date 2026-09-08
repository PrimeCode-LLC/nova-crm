"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2, ExternalLink, Library } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  CONTENT_BRAND_KIND_LABELS,
  type ContentBrand,
  type ContentBrandKind,
} from "@/lib/content-calendar/types";
import {
  displayKnowledgeLibraryName,
  libraryAllowsFeature,
} from "@/lib/ai/knowledge-library-ui";
import { cn } from "@/lib/utils";

type LibraryOption = {
  id: string;
  name: string;
  libraryKind?: string;
  fitCategory?: string;
  scope?: { type?: string; brandId?: string };
  allowedFeatures?: string[];
  documentCount?: number;
};

/**
 * Content brands for the AI & knowledge admin — identity + which Content-allowed
 * libraries they read. Full strategy editing stays on /content/brands.
 */
export function KnowledgeBrandsAdminPanel() {
  const [brands, setBrands] = React.useState<ContentBrand[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [libraries, setLibraries] = React.useState<LibraryOption[]>([]);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ContentBrand | null>(null);
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<ContentBrandKind>("founder");
  const [voiceRules, setVoiceRules] = React.useState("");
  const [positioning, setPositioning] = React.useState("");
  const [knowledgeLibraryIds, setKnowledgeLibraryIds] = React.useState<string[]>([]);
  const [libQuery, setLibQuery] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<ContentBrand | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const reloadBrands = React.useCallback(async () => {
    const res = await fetch("/api/ai/content-brands", { credentials: "same-origin" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || "Could not load brands");
    }
    const json = (await res.json()) as { brands?: ContentBrand[] };
    setBrands(json.brands ?? []);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [brandRes, libRes] = await Promise.all([
          fetch("/api/ai/content-brands", { credentials: "same-origin" }),
          fetch("/api/ai/rag/libraries", { credentials: "same-origin" }),
        ]);
        if (!cancelled && brandRes.ok) {
          const json = (await brandRes.json()) as { brands?: ContentBrand[] };
          setBrands(json.brands ?? []);
        }
        if (!cancelled && libRes.ok) {
          const json = (await libRes.json()) as { libraries?: LibraryOption[] };
          setLibraries(json.libraries ?? []);
        }
        if (!cancelled && !brandRes.ok) {
          toast.error("Could not load brands");
        }
      } catch {
        if (!cancelled) toast.error("Could not load brands");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const contentLibraries = React.useMemo(
    () => libraries.filter((l) => libraryAllowsFeature(l, "content")),
    [libraries],
  );

  const filteredLibraries = React.useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    if (!q) return contentLibraries;
    return contentLibraries.filter((l) => {
      const label = displayKnowledgeLibraryName(l).toLowerCase();
      return label.includes(q) || (l.name ?? "").toLowerCase().includes(q);
    });
  }, [contentLibraries, libQuery]);

  function openCreate() {
    setEditing(null);
    setName("");
    setKind("founder");
    setVoiceRules("");
    setPositioning("");
    setKnowledgeLibraryIds([]);
    setLibQuery("");
    setFormOpen(true);
  }

  function openEdit(brand: ContentBrand) {
    setEditing(brand);
    setName(brand.name);
    setKind(brand.kind);
    setVoiceRules(brand.voiceRules ?? "");
    setPositioning(brand.positioning ?? "");
    setKnowledgeLibraryIds([...brand.knowledgeLibraryIds]);
    setLibQuery("");
    setFormOpen(true);
  }

  function toggleLibrary(id: string) {
    setKnowledgeLibraryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        kind,
        voiceRules: voiceRules.trim() || undefined,
        positioning: positioning.trim() || undefined,
        knowledgeLibraryIds,
      };
      const res = editing
        ? await fetch(`/api/ai/content-brands/${encodeURIComponent(editing.id)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/ai/content-brands", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Could not save brand");
      }
      await reloadBrands();
      setFormOpen(false);
      toast.success(editing ? "Brand updated" : "Brand created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save brand");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/content-brands/${encodeURIComponent(toDelete.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Could not delete brand");
      }
      setToDelete(null);
      await reloadBrands();
      toast.success("Brand deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete brand");
    } finally {
      setDeleting(false);
    }
  }

  function libraryLabel(id: string) {
    const lib = libraries.find((l) => l.id === id);
    return lib ? displayKnowledgeLibraryName(lib) : id;
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading brands…
      </p>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Content brands</CardTitle>
              <CardDescription className="text-xs mt-1">
                Brands are for Content calendar and Capture only. Link libraries that allow Content —
                Fit Check and email use outreach profiles instead.
              </CardDescription>
            </div>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add brand
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {brands.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No brands yet. Create one here, or open the full Content brands workspace.
            </p>
          ) : (
            <ul className="space-y-2">
              {brands.map((brand) => (
                <li
                  key={brand.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{brand.name}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {CONTENT_BRAND_KIND_LABELS[brand.kind] ?? brand.kind}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {brand.knowledgeLibraryIds.length} libraries
                      </span>
                    </div>
                    {brand.knowledgeLibraryIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {brand.knowledgeLibraryIds.slice(0, 4).map((id) => (
                          <Badge key={id} variant="outline" className="text-[10px] font-normal">
                            <Library className="h-3 w-3 mr-1" />
                            {libraryLabel(id)}
                          </Badge>
                        ))}
                        {brand.knowledgeLibraryIds.length > 4 ? (
                          <span className="text-[10px] text-muted-foreground">
                            +{brand.knowledgeLibraryIds.length - 4}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No Content libraries linked</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button type="button" size="sm" variant="outline" onClick={() => openEdit(brand)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setToDelete(brand)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/content/brands"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex gap-1")}
          >
            Full brand strategy
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit brand" : "Add brand"}</DialogTitle>
            <DialogDescription>
              Link Content-allowed libraries this brand may read for Capture and drafts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand-name">Name</Label>
              <Input
                id="brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stellix Soft"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ContentBrandKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_BRAND_KIND_LABELS) as ContentBrandKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CONTENT_BRAND_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-positioning">Positioning</Label>
              <Textarea
                id="brand-positioning"
                value={positioning}
                onChange={(e) => setPositioning(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-voice">Voice rules</Label>
              <Textarea
                id="brand-voice"
                value={voiceRules}
                onChange={(e) => setVoiceRules(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Content libraries</Label>
              <Input
                value={libQuery}
                onChange={(e) => setLibQuery(e.target.value)}
                placeholder="Filter libraries…"
              />
              <div className="max-h-40 overflow-y-auto space-y-1 rounded-md border p-2">
                {filteredLibraries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No Content-allowed libraries</p>
                ) : (
                  filteredLibraries.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={knowledgeLibraryIds.includes(l.id)}
                        onCheckedChange={() => toggleLibrary(l.id)}
                      />
                      <span className="truncate">{displayKnowledgeLibraryName(l)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete brand?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {toDelete?.name}. Knowledge libraries stay; only the brand link is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
