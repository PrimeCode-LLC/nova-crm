"use client";

import * as React from "react";
import type { Note } from "@/lib/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pin, Trash2, Pencil } from "lucide-react";
import { fmtRelative, fmtDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function LeadNotes({ notes }: { notes: Note[] }) {
  const { getUserById } = useWorkspace();
  const [body, setBody] = React.useState("");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a note… supports plain text."
          className="min-h-[80px] resize-none border-0 focus-visible:ring-0 p-0 shadow-none"
        />
        <div className="flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" disabled={!body}>
            Cancel
          </Button>
          <Button size="sm" disabled={!body.trim()}>
            Post note
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {notes
          .slice()
          .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
          .map((n) => {
            const author = getUserById(n.authorId);
            return (
              <div
                key={n.id}
                className={cn(
                  "flex gap-3 rounded-lg border p-3 bg-card",
                  n.pinned && "border-amber-500/30 bg-amber-500/5",
                )}
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                    {initials(author?.displayName ?? "?")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="font-medium text-sm">{author?.displayName ?? "Unknown"}</span>
                    <span className="text-muted-foreground" title={fmtDate(n.createdAt, "PPpp")}>
                      {fmtRelative(n.createdAt)}
                    </span>
                    {n.pinned && (
                      <Badge
                        variant="outline"
                        className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] gap-1"
                      >
                        <Pin className="h-2.5 w-2.5" /> Pinned
                      </Badge>
                    )}
                    <div className="ml-auto flex opacity-0 hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon-xs">
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon-xs">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                </div>
              </div>
            );
          })}
        {notes.length === 0 && (
          <div className="rounded-md border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No notes yet.
          </div>
        )}
      </div>
    </div>
  );
}
