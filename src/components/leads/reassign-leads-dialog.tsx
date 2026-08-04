"use client";

import * as React from "react";
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
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOrgMembers } from "@/hooks/use-org-members";
import type { BulkOwnerReassignItem } from "@/lib/firestore/persist-bulk-owner-reassign-client";
import { isProspectRow, prospectPatchForSalesLeadSync } from "@/lib/prospects/prospect-access";
import type { Lead, OrganizationMember, User } from "@/lib/types";

const OPEN_QUEUE_OWNER_VALUE = "__open_queue__";

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

function ownerPatchForLead(lead: Lead, nextOwnerId: string): Partial<Lead> {
  const patch: Partial<Lead> = { ownerId: nextOwnerId };
  // Transfer prospect ownership with sales ownership so access + filters stay aligned.
  if (isProspectRow(lead) && nextOwnerId) {
    patch.prospectOwnerId = nextOwnerId;
  }
  return patch;
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
    bulkReassignOwners,
    currentUserId,
  } = useWorkspace();
  const [newOwnerId, setNewOwnerId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [progressDone, setProgressDone] = React.useState(0);
  const [progressTotal, setProgressTotal] = React.useState(0);
  const membersQuery = useOrgMembers(open && !isDemo);
  const ownersLoading = open && !isDemo && membersQuery.isLoading;
  const ownerOptions = React.useMemo(() => {
    if (!open) return [];
    if (isDemo) return workspaceUsersAsOptions(users);
    if (membersQuery.isError) return workspaceUsersAsOptions(users);
    if (!membersQuery.data) return [];
    const fromMembers = activeMemberOwnerOptions(membersQuery.data, users);
    return fromMembers.length > 0 ? fromMembers : workspaceUsersAsOptions(users);
  }, [open, isDemo, users, membersQuery.data, membersQuery.isError]);

  React.useEffect(() => {
    if (!open || isDemo || !membersQuery.isError) return;
    toast.message("Could not load full team list", {
      description: "Showing workspace users only. Try again or refresh.",
    });
  }, [open, isDemo, membersQuery.isError]);

  const targets = React.useMemo(
    () =>
      leadIds
        .map((id) => ({ id, lead: getLeadById(id) }))
        .filter((x): x is { id: string; lead: Lead } => Boolean(x.lead)),
    [leadIds, getLeadById],
  );
  const mostlyProspects =
    targets.length > 0 &&
    targets.filter((t) => isProspectRow(t.lead)).length >= Math.ceil(targets.length / 2);
  const noun = mostlyProspects ? "prospect" : "lead";
  const nouns = mostlyProspects ? "prospects" : "leads";

  React.useEffect(() => {
    if (open) {
      setNewOwnerId("");
      setProgressDone(0);
      setProgressTotal(0);
      setSubmitting(false);
    }
  }, [open, leadIds.join(",")]);

  function displayOwnerName(ownerId: string): string {
    if (!ownerId.trim()) return "Open queue";
    return (
      ownerOptions.find((o) => o.id === ownerId)?.label ??
      getUserById(ownerId)?.displayName?.trim() ??
      getOwnerDisplayName(ownerId) ??
      ownerId
    );
  }

  async function onSubmit() {
    if (!newOwnerId) {
      toast.error(`Choose who should own the selected ${nouns}.`);
      return;
    }
    if (!leadIds.length) return;

    const owner =
      newOwnerId === OPEN_QUEUE_OWNER_VALUE ? "" : newOwnerId.trim();
    if (newOwnerId !== OPEN_QUEUE_OWNER_VALUE && !owner) {
      toast.error(`Choose who should own the selected ${nouns}.`);
      return;
    }

    if (!targets.length) {
      toast.error(`No matching ${nouns} to update.`);
      return;
    }

    const already = targets.filter((t) => (t.lead.ownerId?.trim() || "") === owner);
    if (already.length === targets.length) {
      const who = displayOwnerName(owner);
      toast.message("No change", {
        description:
          targets.length === 1
            ? `This ${noun} is already assigned to ${who}.`
            : `These ${nouns} are already assigned to ${who}.`,
      });
      return;
    }

    const toUpdate = targets.filter((t) => (t.lead.ownerId?.trim() || "") !== owner);
    const items: BulkOwnerReassignItem[] = toUpdate.map(({ id, lead }) => {
      const current = lead.ownerId?.trim() || "";
      const leadPatch = ownerPatchForLead(lead, owner);
      const linkedSalesLeadId = lead.linkedSalesLeadId?.trim();
      const linkedSalesPatch =
        isProspectRow(lead) && linkedSalesLeadId
          ? prospectPatchForSalesLeadSync(leadPatch)
          : undefined;

      return {
        leadId: id,
        previousOwnerId: current,
        leadPatch,
        linkedSalesLeadId:
          linkedSalesPatch && Object.keys(linkedSalesPatch).length > 0
            ? linkedSalesLeadId
            : undefined,
        linkedSalesPatch:
          linkedSalesPatch && Object.keys(linkedSalesPatch).length > 0
            ? linkedSalesPatch
            : undefined,
        accountId: lead.accountId,
        contactId: lead.contactId,
        timeline: {
          id: newTimelineId(),
          leadId: id,
          type: "assignment_changed",
          actorId: currentUserId,
          summary: `Reassigned from ${displayOwnerName(current)} to ${displayOwnerName(owner)}`,
          createdAt: new Date().toISOString(),
        },
      };
    });

    setSubmitting(true);
    setProgressDone(0);
    setProgressTotal(items.length);
    try {
      await bulkReassignOwners(items, owner, (done, total) => {
        setProgressDone(done);
        setProgressTotal(total);
      });

      const updated = items.length;
      toast.success(
        owner
          ? updated === 1
            ? `${noun[0]!.toUpperCase()}${noun.slice(1)} assigned`
            : `${updated} ${nouns} assigned`
          : updated === 1
            ? `Moved ${noun} to open queue`
            : `Moved ${updated} ${nouns} to open queue`,
      );
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Could not assign owner: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  const title =
    leadIds.length <= 1
      ? `Assign ${noun} owner`
      : `Assign owner (${leadIds.length} ${nouns})`;

  const selectedOwnerDisplay = React.useMemo(() => {
    if (!newOwnerId) return null;
    if (newOwnerId === OPEN_QUEUE_OWNER_VALUE) return "Open queue (unassigned)";
    return (
      ownerOptions.find((o) => o.id === newOwnerId)?.label ??
      getUserById(newOwnerId)?.displayName?.trim() ??
      getOwnerDisplayName(newOwnerId) ??
      null
    );
  }, [newOwnerId, ownerOptions, getUserById, getOwnerDisplayName]);

  const progressPct =
    progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose a teammate (or open queue) for{" "}
            {leadIds.length <= 1 ? `this ${noun}` : `these ${leadIds.length} ${nouns}`}. The Owner
            column and owned-by-me filters update right away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="reassign-owner" className="text-xs font-medium">
              New owner
            </Label>
            <Select
              value={newOwnerId}
              onValueChange={(v) => setNewOwnerId(v ?? "")}
              disabled={ownersLoading || submitting}
            >
              <SelectTrigger id="reassign-owner" className="h-9" disabled={ownersLoading || submitting}>
                <SelectValue placeholder={ownersLoading ? "Loading team…" : "Select teammate…"}>
                  {newOwnerId ? (selectedOwnerDisplay ?? "Selected teammate") : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ownersLoading ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">Loading team…</div>
                ) : (
                  <>
                    <SelectItem value={OPEN_QUEUE_OWNER_VALUE}>Open queue (unassigned)</SelectItem>
                    {ownerOptions.length === 0 ? (
                      <div className="px-2 py-2 text-xs text-muted-foreground">
                        No active teammates found.
                      </div>
                    ) : (
                      ownerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))
                    )}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {submitting && progressTotal > 0 ? (
            <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-3">
              <Progress value={progressPct} className="w-full gap-2">
                <ProgressLabel className="text-xs">
                  {progressPct < 100 ? "Assigning in batches…" : "Finishing…"}
                </ProgressLabel>
                <ProgressValue className="text-xs">
                  {() => `${progressDone} / ${progressTotal} · ${progressPct}%`}
                </ProgressValue>
              </Progress>
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting || ownersLoading || !newOwnerId}
            onClick={() => void onSubmit()}
          >
            {submitting
              ? progressTotal > 0
                ? `${progressPct}%`
                : "Assigning…"
              : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
