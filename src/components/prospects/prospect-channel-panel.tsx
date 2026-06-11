"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { ChannelKey, Lead, ProspectChannelAssignment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChannelChip } from "@/components/common/channel-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useChannelAdminStore } from "@/stores/channel-admin-store";
import { buildChannelOptions } from "@/lib/channel-options";
import {
  buildWorkspaceOwnerPickerOptions,
  ownerPickerTriggerLabel,
} from "@/lib/owner-scope";
import {
  canManageProspectChannels,
  canPushProspectChannel,
  prospectAssigneeIdsFromAssignments,
  prospectOwnerIdOf,
  unpushedAssignmentsForViewer,
} from "@/lib/prospects/prospect-access";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import { CHANNEL_LIST } from "@/lib/constants";

function newAssignmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pca-${crypto.randomUUID()}`;
  }
  return `pca-${Date.now()}`;
}

type DraftRow = {
  key: string;
  channel: ChannelKey | "";
  assigneeId: string;
};

function assignmentsToDrafts(assignments: ProspectChannelAssignment[] | undefined): DraftRow[] {
  return (
    assignments?.map((a) => ({
      key: a.id,
      channel: a.channel,
      assigneeId: a.assigneeId,
    })) ?? []
  );
}

export function ProspectChannelPanel({ prospect }: { prospect: Lead }) {
  const router = useRouter();
  const ws = useWorkspace();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const channelOptions = React.useMemo(() => buildChannelOptions(customChannels), [customChannels]);

  const viewerId = ws.currentUserId ?? "";
  const isOwner = canManageProspectChannels(viewerId, prospect);
  const ownerId = prospectOwnerIdOf(prospect);

  const [drafts, setDrafts] = React.useState<DraftRow[]>(() =>
    assignmentsToDrafts(prospect.prospectChannelAssignments),
  );
  const [saving, setSaving] = React.useState(false);
  const [pushingId, setPushingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDrafts(assignmentsToDrafts(prospect.prospectChannelAssignments));
  }, [prospect.id, prospect.prospectChannelAssignments, prospect.updatedAt]);

  const ownerOptions = React.useMemo(
    () =>
      buildWorkspaceOwnerPickerOptions(
        ws.users,
        viewerId,
        ws.getOwnerDisplayName,
        [...new Set([ownerId, viewerId, ...drafts.map((d) => d.assigneeId)].filter(Boolean))],
      ),
    [ws.users, ws.getOwnerDisplayName, viewerId, ownerId, drafts],
  );

  const usedChannels = new Set(
    drafts.map((d) => d.channel).filter((c): c is ChannelKey => Boolean(c)),
  );

  const unpushedForViewer = unpushedAssignmentsForViewer(prospect, viewerId);

  function addDraftRow() {
    setDrafts((rows) => [...rows, { key: newAssignmentId(), channel: "", assigneeId: viewerId || "" }]);
  }

  function removeDraftRow(key: string) {
    const existing = prospect.prospectChannelAssignments?.find((a) => a.id === key);
    if (existing?.pushedAt) {
      toast.error("Cannot remove a channel that was already pushed to a lead.");
      return;
    }
    setDrafts((rows) => rows.filter((r) => r.key !== key));
  }

  async function saveAssignments() {
    if (!isOwner) return;
    const rows = drafts.filter((d) => d.channel && d.assigneeId.trim());
    if (rows.length === 0) {
      toast.error("Add at least one channel with a responsible person.");
      return;
    }
    const channelSet = new Set<string>();
    for (const row of rows) {
      if (channelSet.has(row.channel)) {
        toast.error("Each channel can only be assigned once.");
        return;
      }
      channelSet.add(row.channel);
    }

    const now = new Date().toISOString();
    const previousById = new Map(
      (prospect.prospectChannelAssignments ?? []).map((a) => [a.id, a]),
    );

    const assignments: ProspectChannelAssignment[] = rows.map((row) => {
      const prev = previousById.get(row.key);
      if (prev?.pushedAt) return prev;
      return {
        id: row.key,
        channel: row.channel as ChannelKey,
        assigneeId: row.assigneeId.trim(),
        assignedAt: prev?.assignedAt ?? now,
        assignedById: ownerId,
      };
    });

    setSaving(true);
    try {
      ws.patchLead(prospect.id, {
        prospectChannelAssignments: assignments,
        prospectAssigneeIds: prospectAssigneeIdsFromAssignments(assignments),
        prospectVisibility: "assigned",
      });
      ws.addTimelineEvent({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `te-${crypto.randomUUID()}`
            : `te-${Date.now()}`,
        leadId: prospect.id,
        type: "field_changed",
        actorId: viewerId,
        summary: `Updated channel assignments (${assignments.length})`,
        createdAt: now,
      });
      toast.success("Channel assignments saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not save assignments", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function pushToLead(assignmentId: string) {
    if (!canPushProspectChannel(viewerId, prospect, assignmentId)) return;
    setPushingId(assignmentId);
    try {
      const res = await fetch(`/api/org/prospects/${prospect.id}/push-to-lead`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });
      const data = (await res.json()) as {
        error?: string;
        salesLeadId?: string;
        salesLead?: Lead;
        created?: boolean;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Push to lead failed");
        return;
      }
      if (data.salesLead) {
        ws.stageCrmEntities({ leads: [data.salesLead] });
      }
      if (data.salesLeadId) {
        toast.success(data.created ? "Shared lead created" : "Channel added to shared lead");
        router.push(`/leads/${data.salesLeadId}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Push to lead failed", { description: msg });
    } finally {
      setPushingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Prospect owner assigns outreach channels and responsible teammates. Each assignee pushes their
        channel into one shared sales lead with matching tags.
      </p>

      {prospect.linkedSalesLeadId ? (
        <p className="text-xs">
          Shared sales lead:{" "}
          <Link href={`/leads/${prospect.linkedSalesLeadId}`} className="text-primary hover:underline">
            View lead →
          </Link>
        </p>
      ) : null}

      {isOwner ? (
        <div className="space-y-3">
          {drafts.map((row) => {
            const pushed = prospect.prospectChannelAssignments?.find(
              (a) => a.id === row.key,
            )?.pushedAt;
            return (
              <div key={row.key} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="grid gap-1.5 min-w-[140px] flex-1">
                  <Label className="text-[11px]">Channel</Label>
                  <Select
                    value={row.channel || undefined}
                    disabled={Boolean(pushed)}
                    onValueChange={(v) =>
                      v &&
                      setDrafts((rows) =>
                        rows.map((r) => (r.key === row.key ? { ...r, channel: v as ChannelKey } : r)),
                      )
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="Select channel">
                        {row.channel
                          ? selectTriggerLabelByKey(row.channel, CHANNEL_LIST)
                          : "Select channel"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {channelOptions.map((c) => (
                        <SelectItem
                          key={c.key}
                          value={c.key}
                          disabled={usedChannels.has(c.key as ChannelKey) && row.channel !== c.key}
                        >
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 min-w-[160px] flex-1">
                  <Label className="text-[11px]">Responsible</Label>
                  <Select
                    value={row.assigneeId || undefined}
                    disabled={Boolean(pushed)}
                    onValueChange={(v) =>
                      v &&
                      setDrafts((rows) =>
                        rows.map((r) => (r.key === row.key ? { ...r, assigneeId: v } : r)),
                      )
                    }
                  >
                    <SelectTrigger size="sm" className="min-w-0">
                      <SelectValue placeholder="Assign teammate">
                        {row.assigneeId
                          ? ownerPickerTriggerLabel(row.assigneeId, ownerOptions)
                          : "Assign teammate"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ownerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {pushed ? (
                  <span className="text-[11px] text-muted-foreground pb-2">Pushed</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() => removeDraftRow(row.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addDraftRow}>
              <Plus className="h-3.5 w-3.5" /> Add channel
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={() => void saveAssignments()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save assignments
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {(prospect.prospectChannelAssignments ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No channels assigned yet.</p>
          ) : (
            (prospect.prospectChannelAssignments ?? []).map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <ChannelChip channel={a.channel} compact />
                  <span className="text-muted-foreground text-xs">
                    {ws.getOwnerDisplayName(a.assigneeId) ?? "Teammate"}
                  </span>
                </div>
                {a.pushedAt ? (
                  <span className="text-[11px] text-muted-foreground">Pushed</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}

      {unpushedForViewer.length > 0 ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium">Your channels</p>
          {unpushedForViewer.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2"
            >
              <ChannelChip channel={a.channel} compact />
              <Button
                type="button"
                size="sm"
                disabled={pushingId === a.id}
                onClick={() => void pushToLead(a.id)}
              >
                {pushingId === a.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Push to lead
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
