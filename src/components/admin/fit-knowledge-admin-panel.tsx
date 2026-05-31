"use client";

import * as React from "react";
import { Loader2, Sparkles, Globe, Link2, Link2Off, FileText, Trash2 } from "lucide-react";
import { FitKnowledgeDocumentsSheet } from "@/components/admin/fit-knowledge-documents-sheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  OPPORTUNITY_SOURCE_LABELS,
  OPPORTUNITY_SOURCE_TYPES,
  type FitCheckCategoryKnowledgeConfig,
  type FitCheckKnowledgeConfig,
} from "@/lib/ai/fit-check-knowledge-types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import { cn } from "@/lib/utils";

type FitLibraryRow = {
  id: string;
  name: string;
  libraryKind?: string;
  fitCategory?: string;
  documentCount?: number;
  chunkCount?: number;
};

export function FitKnowledgeAdminPanel({
  aiEnabled,
  onSeeded,
}: {
  aiEnabled: boolean;
  onSeeded?: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [seedingCategory, setSeedingCategory] = React.useState<OpportunitySourceType | null>(null);
  const [config, setConfig] = React.useState<FitCheckKnowledgeConfig | null>(null);
  const [libraries, setLibraries] = React.useState<FitLibraryRow[]>([]);
  const [docSheet, setDocSheet] = React.useState<{ libraryId: string; label: string } | null>(
    null,
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/rag/fit-knowledge", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        config: FitCheckKnowledgeConfig;
        libraries: FitLibraryRow[];
      };
      setConfig(data.config);
      setLibraries(data.libraries ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

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
        toast.error(data.error ?? "Seed failed");
        return;
      }
      toast.success(
        `Seeded global + ${OPPORTUNITY_SOURCE_TYPES.length} category libraries — ${data.documentsCreated ?? 0} docs, ${data.chunksIndexed ?? 0} chunks`,
      );
      await load();
      onSeeded?.();
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
      await load();
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
      `Delete category "${OPPORTUNITY_SOURCE_LABELS[cat]}"?\nThis removes its knowledge documents and disables it for end-user Fit Check.`,
    );
    if (!ok) return;

    const res = await fetch(`/api/ai/rag/libraries/${encodeURIComponent(libraryId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not delete category");
      return;
    }

    toast.success("Category deleted");
    await load();
  }

  const globalLib = libraries.find(
    (l) => l.libraryKind === "fit_check_global" || l.libraryKind === "fit_check_default",
  );

  if (loading && !config) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fit knowledge…
      </p>
    );
  }

  if (!config) return null;

  const budget = config.retrievalBudget;

  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="border-primary/25 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Fit Check knowledge (cost-efficient layers)
          </CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            <strong>Global</strong> holds your website + ICP (embedded once). Each{" "}
            <strong>category</strong> has a small playbook only (~1 doc) — no duplicate crawl.
            Per check we pull up to {budget.globalChunks} global + {budget.categoryChunks}{" "}
            category chunks (cheap vs re-indexing everything).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" disabled={!aiEnabled || seeding} onClick={() => void seedAll()}>
            {seeding ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Seeding all layers…
              </>
            ) : (
              "Seed / refresh global + all categories"
            )}
          </Button>
          {!aiEnabled && (
            <p className="text-xs text-muted-foreground">Enable Platform AI first (embeddings need a key).</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4" /> Global knowledge base
          </CardTitle>
          <CardDescription className="text-xs">
            Company-wide: stellixsoft.com pages + curated ICP. Sections: ICP, services, pricing, case
            studies, website.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="global-enabled" className="text-sm">
              Global library enabled
            </Label>
            <Switch
              id="global-enabled"
              checked={config.globalEnabled}
              disabled={saving}
              onCheckedChange={(v) => void saveConfig({ globalEnabled: !!v })}
            />
          </div>
          {globalLib ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {globalLib.documentCount ?? 0} documents · {globalLib.chunkCount ?? 0} chunks indexed
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  setDocSheet({
                    libraryId: globalLib.id,
                    label: "Global knowledge — website & ICP",
                  })
                }
              >
                <FileText className="h-3 w-3 mr-1" /> View & edit documents
              </Button>
            </div>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Not seeded yet — run seed above.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Category libraries</CardTitle>
          <CardDescription className="text-xs">
            Toggle each channel and connect/disconnect global knowledge for that category only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {OPPORTUNITY_SOURCE_TYPES.map((cat) => {
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
                    Playbook {lib ? `· ${lib.chunkCount ?? 0} chunks` : "· not seeded"}
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
                          label: `${OPPORTUNITY_SOURCE_LABELS[cat]} playbook`,
                        });
                        return;
                      }
                      void (async () => {
                        const seeded = await seedOneCategory(cat);
                        if (!seeded.ok || !seeded.libraryId) return;
                        setDocSheet({
                          libraryId: seeded.libraryId,
                          label: `${OPPORTUNITY_SOURCE_LABELS[cat]} playbook`,
                        });
                      })();
                    }}
                  >
                    <FileText className="h-3 w-3 mr-1" /> {lib ? "Edit" : "Seed & edit"}
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
                    title="Include global library chunks when scoring this category"
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
                    Global
                  </label>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Retrieval budget (cost control)</CardTitle>
          <CardDescription className="text-xs">
            Max chunks per fit check — lower = smaller prompts and lower LLM cost.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Global chunks</Label>
            <div className="flex gap-1">
              {[3, 5, 8].map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={budget.globalChunks === n ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  disabled={saving}
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
            <Label className="text-xs">Category chunks</Label>
            <div className="flex gap-1">
              {[2, 4, 6].map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={budget.categoryChunks === n ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  disabled={saving}
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
            Total ≤ {budget.globalChunks + budget.categoryChunks} chunks / check
          </Badge>
        </CardContent>
      </Card>

      <FitKnowledgeDocumentsSheet
        open={docSheet != null}
        onOpenChange={(open) => !open && setDocSheet(null)}
        libraryId={docSheet?.libraryId ?? null}
        libraryLabel={docSheet?.label ?? ""}
        onChanged={() => void load()}
      />
    </div>
  );
}
