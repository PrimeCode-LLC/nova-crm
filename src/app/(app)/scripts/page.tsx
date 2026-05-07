"use client";

import * as React from "react";
import { Plus, Pencil, Trash2, Search, Copy } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { ScriptCategory, ScriptLibraryItem } from "@/lib/types";

type ScriptForm = {
  id?: string;
  title: string;
  category: ScriptCategory;
  primaryText: string;
  secondaryText: string;
  tags: string;
};

const CATEGORY_OPTIONS: { value: ScriptCategory; label: string }[] = [
  { value: "pitch", label: "Pitch" },
  { value: "rebuttal", label: "Rebuttal" },
  { value: "email_template", label: "Email template" },
  { value: "call_script", label: "Call script" },
  { value: "meeting_agenda", label: "Meeting agenda" },
  { value: "followup_template", label: "Follow-up template" },
  { value: "other", label: "Other" },
];

const EMPTY_FORM: ScriptForm = {
  title: "",
  category: "pitch",
  primaryText: "",
  secondaryText: "",
  tags: "",
};

function fieldMeta(category: ScriptCategory): {
  primaryLabel: string;
  secondaryLabel: string;
  secondaryOptional: boolean;
} {
  switch (category) {
    case "email_template":
      return {
        primaryLabel: "Email subject",
        secondaryLabel: "Email body",
        secondaryOptional: false,
      };
    case "rebuttal":
      return {
        primaryLabel: "Objection",
        secondaryLabel: "Response script",
        secondaryOptional: false,
      };
    case "call_script":
      return {
        primaryLabel: "Call opener",
        secondaryLabel: "Call script",
        secondaryOptional: false,
      };
    case "meeting_agenda":
      return {
        primaryLabel: "Agenda summary",
        secondaryLabel: "Agenda details",
        secondaryOptional: true,
      };
    case "followup_template":
      return {
        primaryLabel: "Follow-up opener",
        secondaryLabel: "Follow-up body",
        secondaryOptional: false,
      };
    case "pitch":
      return {
        primaryLabel: "Pitch opener",
        secondaryLabel: "Pitch body",
        secondaryOptional: false,
      };
    default:
      return {
        primaryLabel: "Primary text",
        secondaryLabel: "Details",
        secondaryOptional: true,
      };
  }
}

export default function ScriptsPage() {
  const [items, setItems] = React.useState<ScriptLibraryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState<ScriptCategory | "all">("all");
  const [canViewAll, setCanViewAll] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState<ScriptForm>(EMPTY_FORM);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/org/scripts", { cache: "no-store" });
      const data = (await res.json()) as {
        error?: string;
        items?: ScriptLibraryItem[];
        canViewAll?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setItems(data.items ?? []);
      setCanViewAll(Boolean(data.canViewAll));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load scripts");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(item: ScriptLibraryItem) {
    setForm({
      id: item.id,
      title: item.title,
      category: item.category,
      primaryText: item.primaryText || item.content,
      secondaryText: item.secondaryText || "",
      tags: item.tags.join(", "),
    });
    setDialogOpen(true);
  }

  async function submitForm() {
    const meta = fieldMeta(form.category);
    if (!form.title.trim() || !form.primaryText.trim()) {
      toast.error("Title and primary text are required");
      return;
    }
    if (!meta.secondaryOptional && !form.secondaryText.trim()) {
      toast.error(`${meta.secondaryLabel} is required`);
      return;
    }
    setSaving(true);
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch("/api/org/scripts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { id: form.id } : null),
          title: form.title.trim(),
          category: form.category,
          primaryText: form.primaryText.trim(),
          secondaryText: form.secondaryText.trim(),
          tags,
        }),
      });
      const data = (await res.json()) as { error?: string; item?: ScriptLibraryItem };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      if (data.item) {
        setItems((prev) => {
          if (isEdit) {
            return prev.map((i) => (i.id === data.item!.id ? data.item! : i));
          }
          return [data.item!, ...prev];
        });
      }
      setDialogOpen(false);
      toast.success(isEdit ? "Script updated" : "Script saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    if (!confirm("Delete this script/template?")) return;
    try {
      const res = await fetch(`/api/org/scripts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  const filtered = items.filter((item) => {
    const q = query.trim().toLowerCase();
    const hit =
      !q ||
      item.title.toLowerCase().includes(q) ||
      (item.primaryText || "").toLowerCase().includes(q) ||
      (item.secondaryText || "").toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q));
    const categoryHit = categoryFilter === "all" || item.category === categoryFilter;
    return hit && categoryHit;
  });

  return (
    <>
      <PageHeader
        title="Scripts library"
        description={
          canViewAll
            ? "Manage pitches, rebuttals, templates, and scripts across the workspace."
            : "Manage your own pitches, rebuttals, templates, and scripts."
        }
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> New script
          </Button>
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, content, tags..."
            />
          </div>
          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter((v as ScriptCategory | "all") ?? "all")}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3">
          {loading ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">Loading...</CardContent>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                No scripts found.
              </CardContent>
            </Card>
          ) : (
            <Accordion defaultValue={[]} className="flex flex-col gap-3">
              {filtered.map((item) => (
                <AccordionItem key={item.id} value={item.id} className="border-0 p-0">
                  <Card className="gap-0 overflow-hidden py-0" size="sm">
                    <AccordionTrigger className="rounded-none border-0 px-4 py-3 hover:no-underline focus-visible:ring-offset-0 [&>svg]:shrink-0">
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pr-1 text-left">
                        <div className="min-w-0">
                          <div className="text-base font-semibold leading-tight">{item.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">
                              {CATEGORY_OPTIONS.find((c) => c.value === item.category)?.label ??
                                "Other"}
                            </Badge>
                            {canViewAll && (
                              <Badge variant="secondary">{item.ownerName || item.ownerUid}</Badge>
                            )}
                            {item.tags.map((tag) => (
                              <Badge key={tag} variant="secondary">
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div
                          className="flex shrink-0 gap-1"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="icon"
                            variant="ghost"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(item);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeItem(item.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="border-t border-border/60 px-4 pb-4 pt-3">
                      <div className="space-y-3">
                        <ScriptFieldBox
                          label={fieldMeta(item.category).primaryLabel}
                          value={item.primaryText || item.content}
                        />
                        {(item.secondaryText || "").trim() && (
                          <ScriptFieldBox
                            label={fieldMeta(item.category).secondaryLabel}
                            value={item.secondaryText || ""}
                          />
                        )}
                      </div>
                    </AccordionContent>
                  </Card>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </PageBody>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[min(90dvh,900px)] max-w-2xl overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit script" : "New script"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Cold email pitch for SaaS founders"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, category: (v as ScriptCategory) ?? "other" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Tags (comma separated)</Label>
              <Input
                value={form.tags}
                onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                placeholder="saas, founders, outbound"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{fieldMeta(form.category).primaryLabel}</Label>
              <Textarea
                rows={4}
                value={form.primaryText}
                onChange={(e) => setForm((prev) => ({ ...prev, primaryText: e.target.value }))}
                placeholder={fieldMeta(form.category).primaryLabel}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>
                {fieldMeta(form.category).secondaryLabel}
                {fieldMeta(form.category).secondaryOptional ? " (optional)" : ""}
              </Label>
              <Textarea
                rows={12}
                value={form.secondaryText}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, secondaryText: e.target.value }))
                }
                placeholder={fieldMeta(form.category).secondaryLabel}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitForm()} disabled={saving}>
              {saving ? "Saving..." : form.id ? "Save changes" : "Save script"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScriptFieldBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{value}</p>
    </div>
  );
}
