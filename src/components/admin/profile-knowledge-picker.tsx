"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  LinkableKnowledgeDocument,
  LinkableKnowledgeGroup,
  LinkableKnowledgeLibrary,
} from "@/lib/ai/linkable-knowledge-types";

function docSelected(
  documentId: string,
  libraryId: string,
  knowledgeLibraryIds: string[],
  knowledgeDocumentIds: string[],
): boolean {
  if (knowledgeLibraryIds.includes(libraryId)) return true;
  return knowledgeDocumentIds.includes(documentId);
}

function libraryFullySelected(
  lib: LinkableKnowledgeLibrary,
  knowledgeLibraryIds: string[],
): boolean {
  return knowledgeLibraryIds.includes(lib.id);
}

function libraryPartiallySelected(
  lib: LinkableKnowledgeLibrary,
  knowledgeLibraryIds: string[],
  knowledgeDocumentIds: string[],
): boolean {
  if (knowledgeLibraryIds.includes(lib.id)) return false;
  return lib.documents.some((d) => knowledgeDocumentIds.includes(d.id));
}

export function ProfileKnowledgePicker({
  knowledgeLibraryIds,
  knowledgeDocumentIds,
  onKnowledgeLibraryIdsChange,
  onKnowledgeDocumentIdsChange,
}: {
  knowledgeLibraryIds: string[];
  knowledgeDocumentIds: string[];
  onKnowledgeLibraryIdsChange: (ids: string[]) => void;
  onKnowledgeDocumentIdsChange: (ids: string[]) => void;
}) {
  const [groups, setGroups] = React.useState<LinkableKnowledgeGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [openLibs, setOpenLibs] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/ai/fit-check/linkable-libraries", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { groups?: LinkableKnowledgeGroup[] };
        const g = data.groups ?? [];
        setGroups(g);
        const open: Record<string, boolean> = {};
        for (const group of g) {
          for (const lib of group.libraries) {
            open[lib.id] = true;
          }
        }
        setOpenLibs(open);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const q = search.trim().toLowerCase();

  function toggleLibrary(lib: LinkableKnowledgeLibrary, checked: boolean) {
    if (checked) {
      onKnowledgeLibraryIdsChange([...new Set([...knowledgeLibraryIds, lib.id])]);
      onKnowledgeDocumentIdsChange(
        knowledgeDocumentIds.filter((id) => !lib.documents.some((d) => d.id === id)),
      );
    } else {
      onKnowledgeLibraryIdsChange(knowledgeLibraryIds.filter((id) => id !== lib.id));
      onKnowledgeDocumentIdsChange(
        knowledgeDocumentIds.filter((id) => !lib.documents.some((d) => d.id === id)),
      );
    }
  }

  function toggleDocument(
    doc: LinkableKnowledgeDocument,
    lib: LinkableKnowledgeLibrary,
    checked: boolean,
  ) {
    if (knowledgeLibraryIds.includes(lib.id)) {
      onKnowledgeLibraryIdsChange(knowledgeLibraryIds.filter((id) => id !== lib.id));
      const otherDocIds = lib.documents.filter((d) => d.id !== doc.id).map((d) => d.id);
      onKnowledgeDocumentIdsChange([
        ...new Set([
          ...knowledgeDocumentIds.filter((id) => !lib.documents.some((d) => d.id === id)),
          ...otherDocIds,
        ]),
      ]);
      return;
    }

    let nextDocIds: string[];
    if (checked) {
      nextDocIds = [...new Set([...knowledgeDocumentIds, doc.id])];
    } else {
      nextDocIds = knowledgeDocumentIds.filter((id) => id !== doc.id);
    }
    onKnowledgeDocumentIdsChange(nextDocIds);

    const allSelected =
      lib.documents.length > 0 &&
      lib.documents.every((d) => nextDocIds.includes(d.id));
    if (allSelected) {
      onKnowledgeLibraryIdsChange([...new Set([...knowledgeLibraryIds, lib.id])]);
      onKnowledgeDocumentIdsChange(
        nextDocIds.filter((id) => !lib.documents.some((d) => d.id === id)),
      );
    }
  }

  function filterLib(lib: LinkableKnowledgeLibrary): LinkableKnowledgeLibrary | null {
    if (!q) return lib;
    const libMatch =
      lib.name.toLowerCase().includes(q) ||
      lib.fitCategoryLabel?.toLowerCase().includes(q);
    const docs = lib.documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.sectionLabel.toLowerCase().includes(q) ||
        libMatch,
    );
    if (libMatch || docs.length > 0) {
      return { ...lib, documents: libMatch ? lib.documents : docs };
    }
    return null;
  }

  const selectedCount =
    knowledgeLibraryIds.length +
    knowledgeDocumentIds.filter((docId) => {
      return !groups.some((g) =>
        g.libraries.some(
          (lib) => knowledgeLibraryIds.includes(lib.id) && lib.documents.some((d) => d.id === docId),
        ),
      );
    }).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Knowledge libraries & documents</Label>
        {selectedCount > 0 ? (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {selectedCount} selected
          </span>
        ) : null}
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-8 text-xs"
          placeholder="Search libraries or documents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1 py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading knowledge…
        </p>
      ) : groups.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No knowledge found. Add libraries under Admin → AI → Knowledge.
        </p>
      ) : (
        <ScrollArea className="h-[min(280px,40vh)] rounded-md border bg-background/50">
          <div className="p-2 space-y-3">
            {groups.map((group) => {
              const libs = group.libraries
                .map(filterLib)
                .filter((l): l is LinkableKnowledgeLibrary => l != null);
              if (libs.length === 0) return null;

              return (
                <div key={group.id}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1.5">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {libs.map((lib) => {
                      const isOpen = openLibs[lib.id] !== false;
                      const full = libraryFullySelected(lib, knowledgeLibraryIds);
                      const partial = libraryPartiallySelected(
                        lib,
                        knowledgeLibraryIds,
                        knowledgeDocumentIds,
                      );

                      return (
                        <div key={lib.id} className="rounded-md border bg-card/50">
                          <div className="flex items-start gap-2 p-2">
                            <Checkbox
                              checked={full}
                              className="mt-0.5"
                              onCheckedChange={(v) => toggleLibrary(lib, v === true)}
                              aria-label={`Select all in ${lib.name}`}
                            />
                            <button
                              type="button"
                              className="flex-1 min-w-0 text-left"
                              onClick={() =>
                                setOpenLibs((prev) => ({ ...prev, [lib.id]: !isOpen }))
                              }
                            >
                              <div className="flex items-center gap-1">
                                {isOpen ? (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="text-xs font-medium truncate">{lib.name}</span>
                                {partial ? (
                                  <span className="text-[10px] text-primary shrink-0">partial</span>
                                ) : null}
                              </div>
                              <p className="text-[10px] text-muted-foreground ml-[1.35rem] mt-0.5">
                                {lib.documentCount} doc{lib.documentCount === 1 ? "" : "s"}
                                {lib.fitCategoryLabel ? ` · ${lib.fitCategoryLabel}` : ""}
                                {lib.chunkCount ? ` · ${lib.chunkCount} chunks` : ""}
                              </p>
                            </button>
                          </div>

                          {isOpen && lib.documents.length > 0 ? (
                            <div className="border-t px-2 py-1.5 space-y-1 ml-6">
                              {lib.documents.map((doc) => {
                                const on = docSelected(
                                  doc.id,
                                  lib.id,
                                  knowledgeLibraryIds,
                                  knowledgeDocumentIds,
                                );
                                return (
                                  <label
                                    key={doc.id}
                                    className={cn(
                                      "flex items-start gap-2 rounded px-1.5 py-1 cursor-pointer hover:bg-muted/50",
                                      on && "bg-primary/5",
                                    )}
                                  >
                                    <Checkbox
                                      checked={on}
                                      className="mt-0.5"
                                      onCheckedChange={(v) =>
                                        toggleDocument(doc, lib, v === true)
                                      }
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="text-xs block truncate">{doc.title}</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {doc.sectionLabel}
                                        {doc.chunkCount ? ` · ${doc.chunkCount} chunks` : ""}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : null}

                          {isOpen && lib.documents.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground px-2 pb-2 ml-6">
                              No documents, add via Admin → AI → Knowledge.
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
