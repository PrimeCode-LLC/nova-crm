"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

type KnowledgePreview = {
  sourceOrganizationId: string;
  sourceOrganizationName?: string;
  targetOrganizationId: string;
  counts: {
    libraries: number;
    documents: number;
    brands: number;
    profilesWithLibraries: number;
  };
  existing: { libraries: number; documents: number; brands: number };
  willUpsert: {
    libraries: number;
    documents: number;
    brands: number;
    profilesWithLibraries: number;
    fitCheckKnowledge: boolean;
  };
};

type PromptsPreview = {
  sourceOrganizationId: string;
  sourceOrganizationName?: string;
  counts: { prompts: number; overrides: number; defaults: number };
  overrideFeatureKeys: string[];
};

async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}

export function KnowledgePackImportPanel({ onImported }: { onImported?: () => void }) {
  const [knowledgeFile, setKnowledgeFile] = React.useState<File | null>(null);
  const [promptsFile, setPromptsFile] = React.useState<File | null>(null);
  const [knowledgePreview, setKnowledgePreview] = React.useState<KnowledgePreview | null>(null);
  const [promptsPreview, setPromptsPreview] = React.useState<PromptsPreview | null>(null);
  const [indexDocuments, setIndexDocuments] = React.useState(true);
  const [busy, setBusy] = React.useState<
    "preview-k" | "import-k" | "preview-p" | "import-p" | "reindex" | null
  >(null);

  async function previewKnowledge() {
    if (!knowledgeFile) {
      toast.error("Choose a knowledge pack JSON file first");
      return;
    }
    setBusy("preview-k");
    try {
      const pack = await readJsonFile(knowledgeFile);
      const res = await fetch("/api/ai/knowledge-pack?mode=preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(
          typeof json.error === "string"
            ? json.error
            : res.status === 403
              ? "Forbidden — your CRM profile may be missing AI admin access"
              : "Preview failed",
        );
        return;
      }
      setKnowledgePreview(json.preview as KnowledgePreview);
      toast.success("Knowledge pack validated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid JSON");
    } finally {
      setBusy(null);
    }
  }

  async function importKnowledge() {
    if (!knowledgeFile) return;
    setBusy("import-k");
    try {
      const pack = await readJsonFile(knowledgeFile);
      const res = await fetch("/api/ai/knowledge-pack?mode=confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack, indexDocuments }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Import failed");
        return;
      }
      const failed = json.indexed?.failed ?? 0;
      toast.success(
        `Imported ${json.imported.libraries} libraries, ${json.imported.documents} docs, ${json.imported.brands} brands` +
          (indexDocuments ? ` · indexed ${json.indexed.ok}` : "") +
          (failed ? ` · ${failed} index errors` : ""),
      );
      if (failed && Array.isArray(json.indexed?.errors) && json.indexed.errors.length) {
        console.warn("Knowledge pack index errors", json.indexed.errors);
      }
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  async function previewPrompts() {
    if (!promptsFile) {
      toast.error("Choose a prompts pack JSON file first");
      return;
    }
    setBusy("preview-p");
    try {
      const pack = await readJsonFile(promptsFile);
      const res = await fetch("/api/ai/prompts-pack?mode=preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(
          typeof json.error === "string"
            ? json.error
            : res.status === 403
              ? "Forbidden — your CRM profile may be missing AI admin access"
              : "Preview failed",
        );
        return;
      }
      setPromptsPreview(json.preview as PromptsPreview);
      toast.success("Prompts pack validated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid JSON");
    } finally {
      setBusy(null);
    }
  }

  async function importPrompts() {
    if (!promptsFile) return;
    setBusy("import-p");
    try {
      const pack = await readJsonFile(promptsFile);
      const res = await fetch("/api/ai/prompts-pack?mode=confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Import failed");
        return;
      }
      toast.success(
        `Wrote ${json.written} platform prompts` +
          (json.skippedStale ? ` · skipped ${json.skippedStale} stale` : ""),
      );
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  async function reindexAll() {
    setBusy("reindex");
    try {
      const res = await fetch("/api/ai/rag/reindex-all", {
        method: "POST",
        credentials: "same-origin",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Re-index failed");
        return;
      }
      toast.success(
        `Indexed ${json.indexed}/${json.total} documents` +
          (json.failed ? ` · ${json.failed} failed` : ""),
      );
      if (json.failed && Array.isArray(json.errors) && json.errors.length) {
        console.warn("Re-index errors", json.errors);
      }
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-index failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import org knowledge pack</CardTitle>
          <CardDescription>
            Upload a <code className="text-xs">*.knowledge-pack.json</code> into the{" "}
            <strong>current organization</strong>. Libraries, documents, and brands are upserted by
            id. Chunks are rebuilt by re-index (not crawl re-seed).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="knowledge-pack-file">Knowledge pack file</Label>
            <InputFile
              id="knowledge-pack-file"
              accept="application/json,.json"
              onChange={(f) => {
                setKnowledgeFile(f);
                setKnowledgePreview(null);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Re-index documents after import</p>
              <p className="text-xs text-muted-foreground">
                Rebuilds embeddings from imported document text. Requires an org OpenAI key.
              </p>
            </div>
            <Switch checked={indexDocuments} onCheckedChange={setIndexDocuments} />
          </div>
          {knowledgePreview ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                Source: {knowledgePreview.sourceOrganizationName ?? knowledgePreview.sourceOrganizationId}
              </p>
              <p>
                Will upsert {knowledgePreview.willUpsert.libraries} libraries,{" "}
                {knowledgePreview.willUpsert.documents} documents, {knowledgePreview.willUpsert.brands}{" "}
                brands
                {knowledgePreview.willUpsert.fitCheckKnowledge ? " · Fit Check settings" : ""}
              </p>
              <p className="text-muted-foreground">
                Current org already has {knowledgePreview.existing.libraries} libraries /{" "}
                {knowledgePreview.existing.documents} documents / {knowledgePreview.existing.brands}{" "}
                brands (merge by id)
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!knowledgeFile || busy !== null}
              onClick={() => void previewKnowledge()}
            >
              {busy === "preview-k" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Preview
            </Button>
            <Button
              type="button"
              disabled={!knowledgePreview || busy !== null}
              onClick={() => void importKnowledge()}
            >
              {busy === "import-k" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Import into this org
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import platform prompts pack</CardTitle>
          <CardDescription>
            Upload a <code className="text-xs">*.prompts-pack.json</code>. Prompts are{" "}
            <strong>global</strong> (shared across orgs), not scoped to the current tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prompts-pack-file">Prompts pack file</Label>
            <InputFile
              id="prompts-pack-file"
              accept="application/json,.json"
              onChange={(f) => {
                setPromptsFile(f);
                setPromptsPreview(null);
              }}
            />
          </div>
          {promptsPreview ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                {promptsPreview.counts.prompts} prompts ({promptsPreview.counts.overrides} overrides,{" "}
                {promptsPreview.counts.defaults} defaults)
              </p>
              <p className="text-muted-foreground">
                Source org (informational):{" "}
                {promptsPreview.sourceOrganizationName ?? promptsPreview.sourceOrganizationId}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!promptsFile || busy !== null}
              onClick={() => void previewPrompts()}
            >
              {busy === "preview-p" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Preview
            </Button>
            <Button
              type="button"
              disabled={!promptsPreview || busy !== null}
              onClick={() => void importPrompts()}
            >
              {busy === "import-p" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Import global prompts
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Re-index knowledge</CardTitle>
          <CardDescription>
            Documents are imported, but vector chunks only appear after embedding. Requires an OpenAI
            (or configured) API key under Setup. Use this if Overview still shows 0 chunks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void reindexAll()}
          >
            {busy === "reindex" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Re-index all documents
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function InputFile({
  id,
  accept,
  onChange,
}: {
  id: string;
  accept: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <input
      id={id}
      type="file"
      accept={accept}
      className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
      onChange={(e) => onChange(e.target.files?.[0] ?? null)}
    />
  );
}
