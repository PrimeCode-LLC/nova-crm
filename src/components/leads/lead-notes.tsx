"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Note } from "@/lib/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { Pin, Trash2, Pencil, FileText } from "lucide-react";
import { fmtRelative, fmtDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function LeadNotes({
  notes,
  leadId,
  /** Free-form notes saved on the lead record (Edit lead), shared with everyone who can open this lead. */
  leadProfileNotes,
}: {
  notes: Note[];
  leadId: string;
  leadProfileNotes?: string;
}) {
  const { getUserById, addLeadNote, updateLeadNote, deleteLeadNote, currentUserId } = useWorkspace();
  const [body, setBody] = React.useState("");
  const [editOpen, setEditOpen] = React.useState(false);
  const [editBody, setEditBody] = React.useState("");
  const [editId, setEditId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  function post() {
    const t = body.trim();
    if (!t) return;
    addLeadNote(leadId, t, currentUserId);
    setBody("");
    toast.success("Note posted");
  }

  function openEdit(n: Note) {
    setEditId(n.id);
    setEditBody(n.body);
    setEditOpen(true);
  }

  function saveEdit() {
    if (!editId) return;
    const t = editBody.trim();
    if (!t) {
      toast.error("Note cannot be empty.");
      return;
    }
    updateLeadNote(editId, { body: t });
    setEditOpen(false);
    setEditId(null);
    toast.success("Note updated");
  }

  function confirmDelete() {
    if (!deleteId) return;
    deleteLeadNote(deleteId);
    setDeleteId(null);
    toast.success("Note removed");
  }

  const profileText = leadProfileNotes?.trim() ?? "";

  return (
    <div className="space-y-4">
      {profileText ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Lead profile note
          </div>
          <p className="text-xs text-muted-foreground">
            Saved from <span className="font-medium text-foreground">Edit lead</span>. Anyone who can view this lead
            sees it here. To change it, use Edit lead on the lead header.
          </p>
          <p className="text-sm whitespace-pre-wrap text-foreground">{profileText}</p>
        </div>
      ) : null}

      <div className="rounded-lg border p-3 space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a note… supports plain text."
          className="min-h-[80px] resize-none border-0 focus-visible:ring-0 p-0 shadow-none"
        />
        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={!body}
            type="button"
            onClick={() => setBody("")}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={!body.trim()} type="button" onClick={post}>
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
                  n.pinned && "border-warning/30 bg-warning/5",
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
                        className="bg-warning/10 text-warning border-warning/20 text-[10px] gap-1"
                      >
                        <Pin className="h-2.5 w-2.5" /> Pinned
                      </Badge>
                    )}
                    <div className="ml-auto flex opacity-0 hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        type="button"
                        aria-label="Toggle pin"
                        onClick={() => {
                          updateLeadNote(n.id, { pinned: !n.pinned });
                          toast.success(n.pinned ? "Unpinned" : "Pinned");
                        }}
                      >
                        <Pin className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        type="button"
                        aria-label="Edit note"
                        onClick={() => openEdit(n)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        type="button"
                        aria-label="Delete note"
                        onClick={() => setDeleteId(n.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                </div>
              </div>
            );
          })}
        {notes.length === 0 && !profileText && (
          <div className="rounded-md border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No notes yet.
          </div>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
          </DialogHeader>
          <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={5} className="resize-none" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone for this session.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
