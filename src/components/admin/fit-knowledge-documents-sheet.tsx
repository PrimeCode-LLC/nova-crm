"use client";

import * as React from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  KNOWLEDGE_SECTIONS,
  KNOWLEDGE_SECTION_LABELS,
  type KnowledgeSection,
} from "@/lib/ai/fit-check-knowledge-types";

type AiDocumentRow = {
  id: string;
  title: string;
  content: string;
  libraryId: string;
  knowledgeSection?: KnowledgeSection | null;
  chunkCount?: number;
  sourceRef?: string | null;
};

export function FitKnowledgeDocumentsSheet({
  open,
  onOpenChange,
  libraryId,
  libraryLabel,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId: string | null;
  libraryLabel: string;
  onChanged?: () => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [documents, setDocuments] = React.useState<AiDocumentRow[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [section, setSection] = React.useState<KnowledgeSection>("other");
  const [isNew, setIsNew] = React.useState(false);

  const loadDocuments = React.useCallback(async () => {
    if (!libraryId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/rag/documents?libraryId=${encodeURIComponent(libraryId)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        toast.error("Could not load documents");
        return;
      }
      const data = (await res.json()) as { documents: AiDocumentRow[] };
      const rows = (data.documents ?? []).map((d) => ({
        id: d.id,
        title: String(d.title ?? ""),
        content: String(d.content ?? ""),
        libraryId: String(d.libraryId ?? libraryId),
        knowledgeSection: (d.knowledgeSection as KnowledgeSection | null) ?? null,
        chunkCount: d.chunkCount as number | undefined,
        sourceRef: d.sourceRef as string | null | undefined,
      }));
      setDocuments(rows);
      setSelectedId((prev) => {
        if (rows.length === 0) {
          setIsNew(true);
          setTitle("");
          setContent("");
          setSection("other");
          return null;
        }
        const keep = prev && rows.some((r) => r.id === prev) ? prev : rows[0]!.id;
        const doc = rows.find((r) => r.id === keep)!;
        setIsNew(false);
        setTitle(doc.title);
        setContent(doc.content);
        setSection(doc.knowledgeSection ?? "other");
        return keep;
      });
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  function selectDocument(doc: AiDocumentRow) {
    setIsNew(false);
    setSelectedId(doc.id);
    setTitle(doc.title);
    setContent(doc.content);
    setSection(doc.knowledgeSection ?? "other");
  }

  function startNewDocument() {
    setIsNew(true);
    setSelectedId(null);
    setTitle("");
    setContent("");
    setSection(libraryLabel.toLowerCase().includes("playbook") ? "playbook" : "website");
  }

  React.useEffect(() => {
    if (open && libraryId) void loadDocuments();
  }, [open, libraryId, loadDocuments]);

  async function saveDocument() {
    if (!libraryId || !title.trim() || !content.trim()) {
      toast.error("Title and content are required");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const res = await fetch("/api/ai/rag/documents", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            libraryId,
            title: title.trim(),
            content: content.trim(),
            knowledgeSection: section,
            indexNow: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Could not create document");
          return;
        }
        toast.success("Document created and indexed");
      } else if (selectedId) {
        const res = await fetch(`/api/ai/rag/documents/${selectedId}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            content: content.trim(),
            knowledgeSection: section,
            indexNow: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Could not save document");
          return;
        }
        toast.success("Document saved and re-indexed");
      }
      await loadDocuments();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument() {
    if (!selectedId || isNew) return;
    if (!confirm(`Delete "${title}"? This removes its embeddings.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/rag/documents/${selectedId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Could not delete");
        return;
      }
      toast.success("Document deleted");
      setSelectedId(null);
      await loadDocuments();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(90vh,56rem)] w-[min(96vw,80rem)] max-w-[min(96vw,80rem)] flex-col gap-0 overflow-hidden p-0",
          // DialogContent defaults to sm:max-w-sm — override at every breakpoint.
          "sm:max-w-[min(96vw,80rem)]",
        )}
      >
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6 pr-12">
          <DialogTitle className="text-base">{libraryLabel}</DialogTitle>
          <DialogDescription className="text-xs">
            View and edit markdown knowledge used by Fit Check retrieval. Changes are re-embedded on
            save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-row">
          <aside className="flex w-52 shrink-0 flex-col border-r">
            <div className="flex items-center justify-between gap-2 border-b p-2">
              <span className="px-1 text-xs text-muted-foreground">
                {loading ? "…" : `${documents.length} docs`}
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={startNewDocument}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {loading ? (
                <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </p>
              ) : documents.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No documents yet. Add one or run seed.</p>
              ) : (
                <ul className="space-y-0.5 p-1">
                  {documents.map((doc) => (
                    <li key={doc.id}>
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                          selectedId === doc.id && !isNew && "bg-muted font-medium",
                        )}
                        onClick={() => selectDocument(doc)}
                      >
                        <span className="line-clamp-2">{doc.title}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {doc.chunkCount ?? 0} chunks
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="grid shrink-0 gap-3 border-b p-4 sm:grid-cols-[1fr_11rem]">
              <div className="space-y-1">
                <Label className="text-xs">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Section</Label>
                <Select value={section} onValueChange={(v) => setSection(v as KnowledgeSection)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KNOWLEDGE_SECTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {KNOWLEDGE_SECTION_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 pt-3">
              <Label className="shrink-0 text-xs">Content (markdown)</Label>
              <Textarea
                className="min-h-0 flex-1 resize-none font-mono text-sm leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Markdown content…"
              />
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 border-t bg-muted/30 px-4 py-3">
              <Button type="button" size="sm" disabled={saving} onClick={() => void saveDocument()}>
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5 mr-1" /> {isNew ? "Create & index" : "Save & re-index"}
                  </>
                )}
              </Button>
              {!isNew && selectedId && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={saving}
                  onClick={() => void deleteDocument()}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
