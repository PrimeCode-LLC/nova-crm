"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Deal, Lead, PipelineStage, User } from "@/lib/types";
import { PIPELINE_STAGES } from "@/lib/constants";
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

function initialFormState(leads: Lead[], users: User[], currentUserId: string): DealFormState {
  const lead = leads[0];
  return {
    leadId: lead?.id ?? "",
    name: lead ? `${lead.companyName}: New opportunity` : "",
    stage: "qualified",
    value: "10000",
    probability: String(defaultProbability("qualified")),
    closeDate: todayInputValue(),
    ownerId: users.length ? (currentUserId || users[0]!.id) : (lead?.ownerId ?? ""),
  };
}

export function NewDealDialog({
  open,
  onOpenChange,
  leads,
  users,
  currentUserId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  users: User[];
  currentUserId: string;
  onCreate: (deal: Deal) => void;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState(() => initialFormState(leads, users, currentUserId));

  const selectedLead = leads.find((l) => l.id === form.leadId);

  function handleStageChange(next: PipelineStage) {
    setForm((f) => ({
      ...f,
      stage: next,
      probability: String(defaultProbability(next)),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) {
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
      leadId: selectedLead.id,
      accountId: selectedLead.accountId,
      contactId: selectedLead.contactId,
      name: form.name.trim(),
      stage: form.stage,
      value: v,
      currency: "USD",
      probability: Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0)),
      expectedCloseDate: form.closeDate,
      ownerId: users.length ? (form.ownerId || selectedLead.ownerId) : selectedLead.ownerId,
      products: ["Core Platform"],
      createdAt: now,
      updatedAt: now,
    };
    onCreate(deal);
    toast.success("Deal created");
    onOpenChange(false);
    router.push(`/deals/${deal.id}`);
  }

  const canSubmit = leads.length > 0 && Boolean(selectedLead);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New deal</DialogTitle>
            <DialogDescription>
              {leads.length === 0
                ? "Add leads to your workspace first so each deal can link to an account and contact."
                : "Creates a deal for this browser session until your workspace is connected to live data."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="deal-lead">Lead</Label>
              {leads.length > 0 ? (
                <Select
                  value={form.leadId}
                  onValueChange={(leadId) =>
                    setForm((f) => ({ ...f, leadId: leadId ?? "" }))
                  }
                >
                  <SelectTrigger id="deal-lead" className="w-full">
                    <SelectValue placeholder="Select lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.companyName} — {l.contactName}
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
                    <SelectValue />
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
                {users.length > 0 ? (
                  <Select
                    value={form.ownerId || users[0]!.id}
                    onValueChange={(ownerId) =>
                      setForm((f) => ({ ...f, ownerId: ownerId ?? "" }))
                    }
                  >
                    <SelectTrigger id="deal-owner">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.displayName}
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
