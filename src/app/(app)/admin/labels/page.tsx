"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { CrmLabel } from "@/lib/types";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";
import { CRM_LABEL_COLOR_PRESETS } from "@/lib/crm-label-colors";

function newLabelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `lbl-${crypto.randomUUID()}`;
  }
  return `lbl-${Date.now()}`;
}

export default function AdminLabelsPage() {
  const ws = useWorkspace();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  /** Stored on the label (hex from picker or HSL preset string). */
  const [color, setColor] = React.useState("#2563eb");
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editColor, setEditColor] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const tenantOrgId = ws.isDemo ? DEMO_WORKSPACE_ORG_ID : ws.organizationId ?? "";

  const sorted = React.useMemo(
    () => [...ws.crmLabels].sort((a, b) => a.name.localeCompare(b.name)),
    [ws.crmLabels],
  );

  const openCreate = () => {
    setName("");
    setColor("#2563eb");
    setCreateOpen(true);
  };

  const submitCreate = () => {
    const n = name.trim();
    if (!n) {
      toast.error("Enter a label name.");
      return;
    }
    if (!tenantOrgId && !ws.isDemo) {
      toast.error("No organization context.");
      return;
    }
    const now = new Date().toISOString();
    const label: CrmLabel = {
      id: newLabelId(),
      organizationId: tenantOrgId || DEMO_WORKSPACE_ORG_ID,
      name: n,
      color: color.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    ws.addCrmLabel(label);
    toast.success("Label created");
    setCreateOpen(false);
  };

  const openEdit = (l: CrmLabel) => {
    setEditId(l.id);
    setEditName(l.name);
    setEditColor(l.color ?? "");
  };

  const submitEdit = () => {
    if (!editId) return;
    const n = editName.trim();
    if (!n) {
      toast.error("Enter a label name.");
      return;
    }
    ws.updateCrmLabel(editId, { name: n, color: editColor.trim() || undefined });
    toast.success("Label updated");
    setEditId(null);
  };

  return (
    <>
      <PageHeader
        title="Labels"
        description="Create workspace labels, then assign them to leads, prospects, deals, companies, and contacts from each record."
        actions={
          <Button size="sm" type="button" onClick={openCreate}>
            New label
          </Button>
        }
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workspace labels</CardTitle>
            <CardDescription>
              Labels are shared across the org. Removing a label does not remove it from existing records; those
              assignments simply stop resolving until you clear them on each record.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No labels yet. Create one to get started.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sorted.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: l.color ?? "hsl(var(--muted-foreground))" }}
                      />
                      <span className="font-medium truncate">{l.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => openEdit(l)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => setDeleteId(l.id)}>
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </PageBody>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>New label</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="new-lbl-name">Name</Label>
              <Input id="new-lbl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Enterprise" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-lbl-color">Color</Label>
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  id="new-lbl-color"
                  type="color"
                  className="h-9 w-14 cursor-pointer p-1 border rounded-md"
                  value={color.startsWith("#") ? color : "#2563eb"}
                  onChange={(e) => setColor(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">Pick a swatch or use the color input.</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CRM_LABEL_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-6 w-6 rounded-full border border-border ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`Use color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitCreate}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editId !== null} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Edit label</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="edit-lbl-name">Name</Label>
              <Input id="edit-lbl-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-lbl-color">Color</Label>
              <Input
                id="edit-lbl-color"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
                placeholder="#2563eb or hsl(221 83% 53%)"
              />
              <div className="flex flex-wrap gap-1.5">
                {CRM_LABEL_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-6 w-6 rounded-full border border-border"
                    style={{ background: c }}
                    onClick={() => setEditColor(c)}
                    aria-label={`Use color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditId(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this label?</AlertDialogTitle>
            <AlertDialogDescription>
              The label definition will be removed. Records that still reference this id may show the raw id until you
              update them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) ws.removeCrmLabel(deleteId);
                setDeleteId(null);
                toast.success("Label removed");
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
