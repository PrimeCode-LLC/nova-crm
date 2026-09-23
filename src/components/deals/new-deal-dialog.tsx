"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Deal, Lead, PipelineStage, User } from "@/lib/types";
import { PIPELINE_STAGES } from "@/lib/constants";
import {
  leadPickerTriggerLabel,
  selectTriggerLabelById,
  selectTriggerLabelByKey,
} from "@/lib/base-ui-select-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { rememberCrmEntities } from "@/lib/crm/entity-cache";
import { createUserNotification, actorLabel } from "@/lib/notifications/create-user-notification";

function defaultProbability(stage: PipelineStage): number {
  if (stage === "won") return 100;
  if (stage === "lost") return 0;
  if (stage === "negotiation") return 70;
  if (stage === "proposal") return 50;
  if (stage === "discovery" || stage === "qualified") return 25;
  return 15;
}

function isoNow(): string {
  return new Date().toISOString();
}

function todayInputValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type DealFormState = {
  leadId: string;
  name: string;
  stage: PipelineStage;
  value: string;
  probability: string;
  closeDate: string;
  ownerId: string;
};

type OwnerOption = { id: string; label: string };

function buildOwnerOptions(
  users: User[],
  currentUserId: string,
  getOwnerDisplayName?: (uid: string) => string | undefined,
): OwnerOption[] {
  const list: OwnerOption[] = users.map((u) => ({
    id: u.id,
    label:
      u.displayName?.trim() ||
      getOwnerDisplayName?.(u.id)?.trim() ||
      u.email?.trim() ||
      u.id,
  }));
  const uid = currentUserId?.trim();
  if (uid && !list.some((o) => o.id === uid)) {
    const label =
      getOwnerDisplayName?.(uid)?.trim() ||
      users.find((u) => u.id === uid)?.displayName?.trim() ||
      "You";
    list.unshift({ id: uid, label });
  }
  return list;
}

function initialFormState(
  leads: Lead[],
  ownerOptions: OwnerOption[],
  currentUserId: string,
  leadOwnerFallback: string,
): DealFormState {
  const lead = leads[0];
  const defaultOwner =
    ownerOptions.find((o) => o.id === currentUserId)?.id ??
    ownerOptions[0]?.id ??
    leadOwnerFallback;
  return {
    leadId: lead?.id ?? "",
    name: lead ? `${lead.companyName}: New opportunity` : "",
    stage: "qualified",
    value: "10000",
    probability: String(defaultProbability("qualified")),
    closeDate: todayInputValue(),
    ownerId: defaultOwner,
  };
}

export function NewDealDialog({
  open,
  onOpenChange,
  leads,
  users,
  currentUserId,
  getOwnerDisplayName,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  users: User[];
  currentUserId: string;
  /** When the signed-in user is not yet in `users`, resolves a label for the owner picker (workspace roster / org labels). */
  getOwnerDisplayName?: (uid: string) => string | undefined;
  onCreate: (deal: Deal) => void;
}) {
  const router = useRouter();
  const ws = useWorkspace();
  const snapshotOff = isLiveCrmSnapshotDisabled(ws.isDemo);
  const [leadQuery, setLeadQuery] = React.useState("");
  const [remoteLeads, setRemoteLeads] = React.useState<Lead[]>([]);
  React.useEffect(() => {
    if (!open || !snapshotOff) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "20", activeOnly: "1" });
      if (leadQuery.trim()) params.set("q", leadQuery.trim());
      void fetch(`/api/org/leads?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((json: { leads?: Lead[] }) => {
          const rows = Array.isArray(json.leads) ? json.leads : [];
          rememberCrmEntities("leads", rows);
          setRemoteLeads(rows);
        })
        .catch(() => setRemoteLeads([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [open, snapshotOff, leadQuery]);
  const pickerLeads = snapshotOff ? remoteLeads : leads;
  const ownerOptions = React.useMemo(
    () => buildOwnerOptions(users, currentUserId, getOwnerDisplayName),
    [users, currentUserId, getOwnerDisplayName],
  );

  const [form, setForm] = React.useState(() =>
    initialFormState(pickerLeads, ownerOptions, currentUserId, pickerLeads[0]?.ownerId ?? ""),
  );

  React.useEffect(() => {
    if (!open) return;
    setForm((f) => {
      if (pickerLeads.length === 0) return f;
      if (pickerLeads.some((l) => l.id === f.leadId)) return f;
      const first = pickerLeads[0]!;
      return {
        ...f,
        leadId: first.id,
        name: f.name.trim() ? f.name : `${first.companyName}: New opportunity`,
      };
    });
  }, [open, pickerLeads]);

  React.useEffect(() => {
    if (!open) return;
    setForm((f) => {
      if (ownerOptions.length === 0) return f;
      if (ownerOptions.some((o) => o.id === f.ownerId)) return f;
      const next =
        ownerOptions.find((o) => o.id === currentUserId)?.id ?? ownerOptions[0]!.id;
      return { ...f, ownerId: next };
    });
  }, [open, ownerOptions, currentUserId]);

  const resolvedLeadId = pickerLeads.some((l) => l.id === form.leadId)
    ? form.leadId
    : (pickerLeads[0]?.id ?? "");

  function handleStageChange(next: PipelineStage) {
    setForm((f) => ({
      ...f,
      stage: next,
      probability: String(defaultProbability(next)),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const leadForSubmit = pickerLeads.find((l) => l.id === resolvedLeadId);
    if (!leadForSubmit) {
      toast.error("Add at least one lead before creating a deal.");
      return;
    }
    const v = Number(String(form.value).replace(/,/g, ""));
    const p = Number(form.probability);
    if (!form.name.trim()) {
      toast.error("Enter a deal name.");
      return;
    }
    if (!Number.isFinite(v) || v < 0) {
      toast.error("Enter a valid value.");
      return;
    }
    const now = isoNow();
    const deal: Deal = {
      id: `local-${crypto.randomUUID()}`,
      leadId: leadForSubmit.id,
      accountId: leadForSubmit.accountId,
      contactId: leadForSubmit.contactId,
      name: form.name.trim(),
      stage: form.stage,
      value: v,
      currency: "USD",
      probability: Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0)),
      expectedCloseDate: form.closeDate,
      ownerId:
        ownerOptions.length === 0
          ? leadForSubmit.ownerId
          : ownerOptions.some((o) => o.id === form.ownerId)
            ? form.ownerId || leadForSubmit.ownerId
            : (ownerOptions.find((o) => o.id === currentUserId)?.id ?? ownerOptions[0]!.id) ||
              leadForSubmit.ownerId,
      products: ["Core Platform"],
      createdAt: now,
      updatedAt: now,
    };
    onCreate(deal);
    if (deal.ownerId && deal.ownerId !== currentUserId) {
      const actor = actorLabel(users, currentUserId);
      void createUserNotification(
        { organizationId: ws.organizationId, isDemo: ws.isDemo },
        {
          organizationId: ws.organizationId || "demo",
          recipientId: deal.ownerId,
          actorId: currentUserId,
          kind: "assignment",
          message: `${actor} assigned you deal: ${deal.name}`,
          target: deal.name,
          targetHref: `/deals/${deal.id}`,
          entityType: "deal",
          entityId: deal.id,
          prefKey: "leadAssigned",
        },
      );
    }
    toast.success("Deal created");
    onOpenChange(false);
    router.push(`/deals/${deal.id}`);
  }

  const canSubmit = pickerLeads.length > 0 && Boolean(pickerLeads.find((l) => l.id === resolvedLeadId));

  const dealLeadTriggerLabel = leadPickerTriggerLabel(resolvedLeadId, pickerLeads);
  const resolvedOwnerId =
    ownerOptions.length === 0
      ? form.ownerId
      : ownerOptions.some((o) => o.id === form.ownerId)
        ? form.ownerId
        : ownerOptions[0]!.id;
  const dealOwnerTriggerLabel = selectTriggerLabelById(resolvedOwnerId, ownerOptions);
  const dealStageTriggerLabel = selectTriggerLabelByKey(form.stage, PIPELINE_STAGES);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New deal</DialogTitle>
            <DialogDescription>
              {pickerLeads.length === 0
                ? "Search for a lead to link this deal."
                : "Creates a deal for this browser session until your workspace is connected to live data."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="deal-lead">Lead</Label>
              {snapshotOff ? (
                <Input
                  value={leadQuery}
                  onChange={(e) => setLeadQuery(e.target.value)}
                  placeholder="Search leads…"
                  className="h-8"
                />
              ) : null}
              {pickerLeads.length > 0 ? (
                <Select
                  value={resolvedLeadId}
                  onValueChange={(leadId) =>
                    setForm((f) => ({ ...f, leadId: leadId ?? "" }))
                  }
                >
                  <SelectTrigger id="deal-lead" className="w-full">
                    <SelectValue placeholder="Select lead">{dealLeadTriggerLabel ?? undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {pickerLeads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.companyName}, {l.contactName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p id="deal-lead" className="text-xs text-muted-foreground py-1">
                  No leads available.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deal-name">Deal name</Label>
              <Input
                id="deal-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Acme Corp: Enterprise plan"
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="deal-stage">Stage</Label>
                <Select
                  value={form.stage}
                  onValueChange={(v) => handleStageChange(v as PipelineStage)}
                >
                  <SelectTrigger id="deal-stage">
                    <SelectValue>{dealStageTriggerLabel ?? undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="deal-owner">Owner</Label>
                {ownerOptions.length > 0 ? (
                  <Select
                    value={
                      ownerOptions.some((o) => o.id === form.ownerId)
                        ? form.ownerId
                        : ownerOptions[0]!.id
                    }
                    onValueChange={(ownerId) =>
                      setForm((f) => ({ ...f, ownerId: ownerId ?? "" }))
                    }
                  >
                    <SelectTrigger id="deal-owner">
                      <SelectValue placeholder="Select owner">{dealOwnerTriggerLabel ?? undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ownerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">
                    Uses the lead&apos;s owner until users are configured in your workspace.
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="deal-value">Value (USD)</Label>
                <Input
                  id="deal-value"
                  type="text"
                  inputMode="decimal"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="deal-prob">Probability %</Label>
                <Input
                  id="deal-prob"
                  type="number"
                  min={0}
                  max={100}
                  value={form.probability}
                  onChange={(e) => setForm((f) => ({ ...f, probability: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deal-close">Expected close</Label>
              <Input
                id="deal-close"
                type="date"
                value={form.closeDate}
                onChange={(e) => setForm((f) => ({ ...f, closeDate: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create deal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
