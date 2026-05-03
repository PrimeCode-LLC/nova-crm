"use client";

import * as React from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { OrganizationMember, TimelineEvent, User } from "@/lib/types";

type OwnerOption = { id: string; label: string };

function workspaceUsersAsOptions(users: User[]): OwnerOption[] {
  return users
    .filter((u) => u.status !== "inactive")
    .map((u) => ({
      id: u.id,
      label: u.displayName?.trim() || u.email.split("@")[0] || u.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Org membership subcollection is the full roster; CRM `users` docs may omit teammates without `organizationId`. */
function activeMemberOwnerOptions(members: OrganizationMember[], crmUsers: User[]): OwnerOption[] {
  const uidToUser = new Map(crmUsers.map((u) => [u.id, u]));
  const opts: OwnerOption[] = [];
  for (const m of members) {
    if (m.status !== "active") continue;
    const u = uidToUser.get(m.uid);
    const label =
      m.displayName?.trim() ||
      u?.displayName?.trim() ||
      (m.email.includes("@") ? m.email.split("@")[0] : m.email) ||
      u?.email.split("@")[0] ||
      m.uid;
    opts.push({ id: m.uid, label });
  }
  opts.sort((a, b) => a.label.localeCompare(b.label));
  return opts;
}

function newTimelineId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `te-local-${crypto.randomUUID()}`;
  }
  return `te-local-${Date.now()}`;
}

export function ReassignLeadsDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onSuccess?: () => void;
}) {
  const {
    isDemo,
    getLeadById,
    getUserById,
    getOwnerDisplayName,
    users,
    patchLead,
    bumpLeadActivity,
    addTimelineEvent,
    currentUserId,
  } = useWorkspace();
  const { user: fbUser } = useAuth();
  const { data: liveUserDoc } = useUserDoc(
    isDemo || isAuthDisabled() || !fbUser ? undefined : fbUser.uid,
  );
  const [newOwnerId, setNewOwnerId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [ownerOptions, setOwnerOptions] = React.useState<OwnerOption[]>([]);
  const [ownersLoading, setOwnersLoading] = React.useState(false);

  React.useEffect(() => {
    if (open) setNewOwnerId("");
  }, [open, leadIds.join(",")]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    if (isDemo) {
      setOwnerOptions(workspaceUsersAsOptions(users));
      setOwnersLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setOwnersLoading(true);
    setOwnerOptions([]);
    void fetch("/api/org/members", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) {
            setOwnerOptions(workspaceUsersAsOptions(users));
            toast.message("Could not load full team list", {
              description: "Showing workspace users only. Try again or refresh.",
            });
          }
          return;
        }
        const data = (await res.json()) as { members?: OrganizationMember[] };
        const members = data.members ?? [];
        if (cancelled) return;
        const fromMembers = activeMemberOwnerOptions(members, users);
        setOwnerOptions(
          fromMembers.length > 0 ? fromMembers : workspaceUsersAsOptions(users),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setOwnerOptions(workspaceUsersAsOptions(users));
          toast.message("Could not load team list", {
            description: "Showing workspace users only.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setOwnersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, isDemo, users]);

  async function onSubmit() {
    const owner = newOwnerId.trim();
    if (!owner) {
      toast.error("Choose a teammate to assign the lead to.");
      return;
    }
    if (!leadIds.length) return;

    const targets = leadIds.map((id) => ({ id, lead: getLeadById(id) })).filter((x) => x.lead);
    if (!targets.length) {
      toast.error("No matching leads to update.");
      return;
    }
    const already = targets.filter((t) => t.lead!.ownerId === owner);
    if (already.length === targets.length) {
      const who =
        ownerOptions.find((o) => o.id === owner)?.label ??
        getUserById(owner)?.displayName?.trim() ??
        getOwnerDisplayName(owner) ??
        owner;
      toast.message("No change", {
        description:
          targets.length === 1
            ? `This lead is already assigned to ${who}.`
            : `These leads are already assigned to ${who}.`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const writeFs =
        !isDemo && isFirebaseWebConfigured() && liveUserDoc?.organizationId;

      const db = writeFs ? getFirebaseDb() : null;
      for (const { id, lead } of targets) {
        if (!lead || lead.ownerId === owner) continue;
        if (writeFs && db) {
          await updateDoc(doc(db, COLLECTIONS.leads, id), {
            ownerId: owner,
            updatedAt: serverTimestamp(),
          });
        } else {
          patchLead(id, { ownerId: owner });
        }
        const fromName =
          getUserById(lead.ownerId)?.displayName?.trim() ||
          getOwnerDisplayName(lead.ownerId) ||
          "Unassigned";
        const toName =
          ownerOptions.find((o) => o.id === owner)?.label ??
          getUserById(owner)?.displayName?.trim() ??
          getOwnerDisplayName(owner) ??
          owner;
        addTimelineEvent({
          id: newTimelineId(),
          leadId: id,
          type: "assignment_changed",
          actorId: currentUserId,
          summary: `Reassigned from ${fromName} to ${toName}`,
          createdAt: new Date().toISOString(),
        });
        bumpLeadActivity(id);
      }

      const n = targets.filter((t) => t.lead && t.lead.ownerId !== owner).length;
      toast.success(n === 1 ? "Lead reassigned" : `${n} leads reassigned`);
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Could not reassign: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  const title = leadIds.length <= 1 ? "Reassign lead" : `Reassign ${leadIds.length} leads`;

  /** Base UI Select can show the raw `value` (uid) when the trigger cannot resolve the item label; always pass an explicit label. */
  const selectedOwnerDisplay = React.useMemo(() => {
    if (!newOwnerId) return null;
    return (
      ownerOptions.find((o) => o.id === newOwnerId)?.label ??
      getUserById(newOwnerId)?.displayName?.trim() ??
      getOwnerDisplayName(newOwnerId) ??
      null
    );
  }, [newOwnerId, ownerOptions, getUserById, getOwnerDisplayName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Pick who should own {leadIds.length <= 1 ? "this lead" : "these leads"}. The Owner column and
            owned-by-me views update for the teammate you pick.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="reassign-owner" className="text-xs font-medium">
            New owner
          </Label>
          <Select value={newOwnerId} onValueChange={(v) => setNewOwnerId(v ?? "")}>
            <SelectTrigger id="reassign-owner" className="h-9" disabled={ownersLoading}>
              <SelectValue placeholder={ownersLoading ? "Loading team…" : "Select teammate…"}>
                {newOwnerId ? (selectedOwnerDisplay ?? "Selected teammate") : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ownersLoading ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">Loading team…</div>
              ) : ownerOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">No active teammates found.</div>
              ) : (
                ownerOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting || ownersLoading || !newOwnerId || ownerOptions.length === 0}
            onClick={() => void onSubmit()}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
