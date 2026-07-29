"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { CRM_LABEL_COLOR_PRESETS, crmLabelColorByIndex } from "@/lib/crm-label-colors";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";
import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { CrmLabel, Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

function newLabelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `lbl-${crypto.randomUUID()}`;
  }
  return `lbl-${Date.now()}`;
}

function mergeLabelIds(existing: string[] | undefined, addIds: string[]): string[] {
  const next = new Set(existing ?? []);
  for (const id of addIds) next.add(id);
  return [...next];
}

export function BulkTagLeadsDialog({
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
  const ws = useWorkspace();
  const { getLeadById, canEditLead, patchLeadAsync, addCrmLabel, crmLabels, isDemo, organizationId } =
    ws;

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [localCreated, setLocalCreated] = React.useState<CrmLabel[]>([]);
  const [createName, setCreateName] = React.useState("");
  const [createColor, setCreateColor] = React.useState<string>(CRM_LABEL_COLOR_PRESETS[0]!);
  const [showCreate, setShowCreate] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [progressDone, setProgressDone] = React.useState(0);
  const [progressTotal, setProgressTotal] = React.useState(0);

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

  const allLabels = React.useMemo(() => {
    const byId = new Map<string, CrmLabel>();
    for (const l of crmLabels) byId.set(l.id, l);
    for (const l of localCreated) {
      if (!byId.has(l.id)) byId.set(l.id, l);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [crmLabels, localCreated]);

  React.useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setLocalCreated([]);
    setCreateName("");
    setCreateColor(crmLabelColorByIndex(crmLabels.length));
    setShowCreate(false);
    setSubmitting(false);
    setProgressDone(0);
    setProgressTotal(0);
  }, [open, leadIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on open/selection

  const toggleLabel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tenantOrgId = isDemo ? DEMO_WORKSPACE_ORG_ID : organizationId ?? "";

  const createAndSelect = () => {
    const n = createName.trim();
    if (!n) {
      toast.error("Enter a label name.");
      return;
    }
    const dup = allLabels.find((l) => l.name.toLowerCase() === n.toLowerCase());
    if (dup) {
      toast.message("Label already exists", {
        description: `"${dup.name}" was selected instead.`,
      });
      setSelectedIds((prev) => new Set(prev).add(dup.id));
      setCreateName("");
      setShowCreate(false);
      return;
    }
    if (!tenantOrgId && !isDemo) {
      toast.error("No organization context.");
      return;
    }
    const now = new Date().toISOString();
    const label: CrmLabel = {
      id: newLabelId(),
      organizationId: tenantOrgId || DEMO_WORKSPACE_ORG_ID,
      name: n,
      color: createColor.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    addCrmLabel(label);
    setLocalCreated((prev) => [...prev, label]);
    setSelectedIds((prev) => new Set(prev).add(label.id));
    setCreateName("");
    setCreateColor(crmLabelColorByIndex(allLabels.length + 1));
    setShowCreate(false);
    toast.success("Label created", { description: `"${label.name}" will be applied on save.` });
  };

  const applyTags = async () => {
    const addIds = [...selectedIds];
    if (!addIds.length) {
      toast.error("Select or create at least one label.");
      return;
    }
    if (!targets.length) {
      toast.error(`No ${nouns} found for this selection.`);
      return;
    }

    const editable = targets.filter((t) => canEditLead(t.lead));
    const skipped = targets.length - editable.length;
    if (!editable.length) {
      toast.error(`You cannot edit the selected ${nouns}.`);
      return;
    }

    setSubmitting(true);
    setProgressDone(0);
    setProgressTotal(editable.length);
    let updated = 0;
    let failed = 0;

    for (const { id, lead } of editable) {
      const nextIds = mergeLabelIds(lead.labelIds, addIds);
      const unchanged =
        nextIds.length === (lead.labelIds?.length ?? 0) &&
        nextIds.every((lid) => lead.labelIds?.includes(lid));
      if (unchanged) {
        updated += 1;
        setProgressDone((d) => d + 1);
        continue;
      }
      try {
        await patchLeadAsync(id, { labelIds: nextIds });
        updated += 1;
      } catch {
        failed += 1;
      }
      setProgressDone((d) => d + 1);
    }

    setSubmitting(false);

    if (updated > 0) {
      const labelWord = addIds.length === 1 ? "label" : "labels";
      toast.success(
        updated === 1
          ? `Tagged 1 ${noun}`
          : `Tagged ${updated} ${nouns}`,
        {
          description: [
            `Added ${addIds.length} ${labelWord}.`,
            skipped ? `${skipped} skipped (no edit access).` : null,
            failed ? `${failed} failed.` : null,
          ]
            .filter(Boolean)
            .join(" "),
        },
      );
      onOpenChange(false);
      onSuccess?.();
      return;
    }

    toast.error(failed ? "Could not update labels" : "Nothing to update", {
      description: skipped
        ? `${skipped} ${nouns} skipped (no edit access).`
        : failed
          ? "Check permissions or try again."
          : undefined,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>Tag {nouns}</DialogTitle>
          <DialogDescription>
            Add labels to {leadIds.length} selected {leadIds.length === 1 ? noun : nouns}. Existing
            labels are kept; selected tags are added.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          {allLabels.length === 0 && !showCreate ? (
            <p className="text-sm text-muted-foreground">
              No labels yet. Create one below to tag this selection.
            </p>
          ) : (
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {allLabels.map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`bulk-lbl-${l.id}`}
                    checked={selectedIds.has(l.id)}
                    onCheckedChange={() => toggleLabel(l.id)}
                    disabled={submitting}
                  />
                  <Label
                    htmlFor={`bulk-lbl-${l.id}`}
                    className="flex flex-1 cursor-pointer items-center gap-1.5 text-sm font-normal leading-tight"
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: l.color ?? "hsl(var(--muted-foreground))" }}
                    />
                    {l.name}
                  </Label>
                </div>
              ))}
            </div>
          )}

          {showCreate ? (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <div className="grid gap-2">
                <Label htmlFor="bulk-new-lbl-name">New label name</Label>
                <Input
                  id="bulk-new-lbl-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Hot lead"
                  disabled={submitting}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createAndSelect();
                    }
                  }}
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CRM_LABEL_COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={submitting}
                      className={cn(
                        "h-6 w-6 rounded-full border border-border ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        createColor === c && "ring-2 ring-ring",
                      )}
                      style={{ background: c }}
                      onClick={() => setCreateColor(c)}
                      aria-label={`Use color ${c}`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => {
                    setShowCreate(false);
                    setCreateName("");
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={submitting} onClick={createAndSelect}>
                  Create & select
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              disabled={submitting}
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Create new label
            </Button>
          )}

          {submitting && progressTotal > 0 ? (
            <Progress
              value={Math.round((progressDone / progressTotal) * 100)}
              className="w-full gap-2"
            >
              <ProgressLabel className="text-xs">Updating…</ProgressLabel>
              <ProgressValue className="text-xs">
                {() => `${progressDone} / ${progressTotal}`}
              </ProgressValue>
            </Progress>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || selectedIds.size === 0}
            onClick={() => void applyTags()}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Applying…
              </>
            ) : (
              `Apply to ${leadIds.length}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
