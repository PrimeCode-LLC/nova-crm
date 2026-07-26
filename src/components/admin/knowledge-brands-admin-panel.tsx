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
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
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
  const data = useContentCalendarData();
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

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/ai/rag/libraries", { credentials: "same-origin" });
        if (!res.ok) return;
        const json = (await res.json()) as { libraries?: LibraryOption[] };
        setLibraries(json.libraries ?? []);
      } catch {
        /* optional */
      }
    })();
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
      if (editing) {
        await data.updateBrand(editing.id, {
          name: name.trim(),
          kind,
          voiceRules: voiceRules.trim(),
          positioning: positioning.trim(),
          knowledgeLibraryIds,
        });
      } else {
        await data.createBrand({
          name: name.trim(),
          kind,
          voiceRules: voiceRules.trim() || undefined,
          positioning: positioning.trim() || undefined,
          knowledgeLibraryIds,
        });
      }
      setFormOpen(false);
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
      await data.deleteBrand(toDelete.id);
      setToDelete(null);
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

  if (data.loading) {
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
              <Plus className="h-3.5 w-3.5 mr-1" /> Add brand
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.brands.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No brands yet. Create one here, or open the full Content brands workspace.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.brands.map((brand) => (
                <li
                  key={brand.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{brand.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {CONTENT_BRAND_KIND_LABELS[brand.kind]} ·{" "}
                      {brand.knowledgeLibraryIds.length
                        ? `${brand.knowledgeLibraryIds.length} libraries`
                        : "Company knowledge fallback"}
                    </p>
                    {brand.knowledgeLibraryIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {brand.knowledgeLibraryIds.slice(0, 4).map((id) => (
                          <Badge key={id} variant="outline" className="text-[9px] font-normal">
                            {libraryLabel(id)}
                          </Badge>
                        ))}
                        {brand.knowledgeLibraryIds.length > 4 ? (
                          <Badge variant="outline" className="text-[9px] font-normal">
                            +{brand.knowledgeLibraryIds.length - 4}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => openEdit(brand)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive"
                    onClick={() => setToDelete(brand)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/content/brands"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-7 text-xs inline-flex gap-1 mt-2",
            )}
          >
            Full brand strategy <ExternalLink className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit brand" : "New content brand"}</DialogTitle>
            <DialogDescription>
              Voice and knowledge for Content calendar. Strategy pillars and cadence live under
              Content brands.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="kb-brand-name">Name</Label>
              <Input
                id="kb-brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hannan Khan"
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
              <Label htmlFor="kb-brand-positioning">Positioning</Label>
              <Textarea
                id="kb-brand-positioning"
                className="min-h-[72px]"
                value={positioning}
                onChange={(e) => setPositioning(e.target.value)}
                placeholder="Who this brand is and what they stand for…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-brand-voice">Voice rules</Label>
              <Textarea
                id="kb-brand-voice"
                className="min-h-[72px]"
                value={voiceRules}
                onChange={(e) => setVoiceRules(e.target.value)}
                placeholder="Tone, style, phrases to prefer or avoid…"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Library className="h-3.5 w-3.5" /> Knowledge libraries
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Only libraries allowed for Content. Leave empty to fall back to Company knowledge.
              </p>
              <Input
                value={libQuery}
                onChange={(e) => setLibQuery(e.target.value)}
                placeholder="Search libraries…"
              />
              <div className="max-h-44 overflow-y-auto rounded-md border p-2 space-y-1">
                {filteredLibraries.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    No Content-allowed libraries. Enable Content on a library under Libraries, then
                    link it here.
                  </p>
                ) : (
                  filteredLibraries.map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={knowledgeLibraryIds.includes(l.id)}
                        onCheckedChange={() => toggleLibrary(l.id)}
                      />
                      <span className="min-w-0 truncate">{displayKnowledgeLibraryName(l)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete brand?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `“${toDelete.name}” will be removed. Calendar items that reference it may need a new brand.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
