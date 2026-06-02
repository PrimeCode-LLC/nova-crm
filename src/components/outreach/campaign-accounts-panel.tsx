"use client";

import * as React from "react";
import { Loader2, Mail, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type WorkspaceAccount = { email: string };

export function CampaignAccountsPanel({
  campaignId,
  accounts,
  connected,
  isDemo,
  canEdit,
  onAccountsChange,
}: {
  campaignId: string;
  accounts: string[];
  connected: boolean;
  isDemo: boolean;
  canEdit: boolean;
  onAccountsChange: (emails: string[]) => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [workspaceAccounts, setWorkspaceAccounts] = React.useState<WorkspaceAccount[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = React.useState(false);

  const [addOpen, setAddOpen] = React.useState(false);
  const [editEmail, setEditEmail] = React.useState<string | null>(null);
  const [deleteEmail, setDeleteEmail] = React.useState<string | null>(null);
  const [pickerSelected, setPickerSelected] = React.useState<Record<string, boolean>>({});
  const [editReplacement, setEditReplacement] = React.useState("");

  const accountSet = React.useMemo(() => new Set(accounts.map((e) => e.toLowerCase())), [accounts]);

  React.useEffect(() => {
    if (!addOpen && !editEmail) return;
    if (!connected && !isDemo) return;
    setLoadingWorkspace(true);
    void (async () => {
      try {
        const res = await fetch("/api/integrations/instantly/accounts");
        if (!res.ok) return;
        const data = (await res.json()) as { accounts?: { email: string }[] };
        setWorkspaceAccounts((data.accounts ?? []).filter((a) => a.email?.trim()));
      } finally {
        setLoadingWorkspace(false);
      }
    })();
  }, [addOpen, editEmail, connected, isDemo]);

  React.useEffect(() => {
    if (editEmail) setEditReplacement(editEmail);
  }, [editEmail]);

  async function persistAccounts(next: string[]) {
    const normalized = [...new Set(next.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length === 0) {
      toast.error("At least one sending account is required");
      return false;
    }

    setSaving(true);
    try {
      if (isDemo) {
        onAccountsChange(normalized);
        toast.success("Sending accounts updated");
        return true;
      }

      const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}/accounts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_list: normalized }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        email_list?: string[];
      };
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Could not update accounts");
        return false;
      }
      const updated = data.email_list ?? normalized;
      onAccountsChange(updated);
      toast.success("Sending accounts updated in Instantly");
      return true;
    } finally {
      setSaving(false);
    }
  }

  const availableToAdd = workspaceAccounts.filter((a) => !accountSet.has(a.email.toLowerCase()));

  const availableForEdit = workspaceAccounts.filter(
    (a) => a.email.toLowerCase() !== editEmail?.toLowerCase(),
  );

  async function confirmAdd() {
    const picked = Object.keys(pickerSelected).filter((e) => pickerSelected[e]);
    if (picked.length === 0) {
      toast.error("Select at least one account");
      return;
    }
    const ok = await persistAccounts([...accounts, ...picked]);
    if (ok) {
      setAddOpen(false);
      setPickerSelected({});
    }
  }

  async function confirmEdit() {
    if (!editEmail || !editReplacement.trim()) return;
    const next = accounts.map((e) =>
      e.toLowerCase() === editEmail.toLowerCase() ? editReplacement.trim().toLowerCase() : e,
    );
    const ok = await persistAccounts(next);
    if (ok) setEditEmail(null);
  }

  async function confirmDelete() {
    if (!deleteEmail) return;
    const next = accounts.filter((e) => e.toLowerCase() !== deleteEmail.toLowerCase());
    const ok = await persistAccounts(next);
    if (ok) setDeleteEmail(null);
  }

  if (!connected && !isDemo) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <Mail className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-2 text-sm text-muted-foreground">Connect Instantly to manage sending accounts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Sending accounts ({accounts.length})
        </p>
        {canEdit && (
          <Button size="sm" disabled={saving} onClick={() => setAddOpen(true)}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add account
          </Button>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Mail className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm font-medium">No sending accounts</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canEdit ? "Add accounts from your Instantly workspace." : "Assign accounts in Instantly."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((email) => {
            const [local, domain] = email.split("@");
            return (
              <div
                key={email}
                className="flex items-center gap-2 rounded-lg border bg-card p-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{local}</p>
                  <p className="truncate text-xs text-muted-foreground">@{domain}</p>
                </div>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Actions for ${email}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditEmail(email)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Replace account
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={accounts.length <= 1}
                        onClick={() => setDeleteEmail(email)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add sending accounts</DialogTitle>
            <DialogDescription>
              Choose Instantly email accounts to assign to this campaign.
            </DialogDescription>
          </DialogHeader>
          {loadingWorkspace ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : availableToAdd.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No more workspace accounts available, or all are already on this campaign.
            </p>
          ) : (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {availableToAdd.map((a) => (
                <label key={a.email} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={Boolean(pickerSelected[a.email])}
                    onCheckedChange={(checked) =>
                      setPickerSelected((prev) => ({ ...prev, [a.email]: Boolean(checked) }))
                    }
                  />
                  <span className="font-mono text-xs">{a.email}</span>
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || availableToAdd.length === 0} onClick={() => void confirmAdd()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Add selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit / replace dialog */}
      <Dialog open={Boolean(editEmail)} onOpenChange={(open) => !open && setEditEmail(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace sending account</DialogTitle>
            <DialogDescription>
              Swap <span className="font-mono text-foreground">{editEmail}</span> for another workspace
              account.
            </DialogDescription>
          </DialogHeader>
          {loadingWorkspace ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">New account</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={editReplacement}
                onChange={(e) => setEditReplacement(e.target.value)}
              >
                {availableForEdit.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.email}
                  </option>
                ))}
              </select>
              {availableForEdit.length === 0 && (
                <p className="text-xs text-muted-foreground">No other workspace accounts available.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEmail(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving || !editReplacement || availableForEdit.length === 0}
              onClick={() => void confirmEdit()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={Boolean(deleteEmail)} onOpenChange={(open) => !open && setDeleteEmail(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove sending account?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{deleteEmail}</span> will be removed from this campaign in
              Instantly. The account stays in your workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
