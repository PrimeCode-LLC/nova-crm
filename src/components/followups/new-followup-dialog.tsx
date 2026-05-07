"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Followup, Lead, LeadPriority } from "@/lib/types";
import { PRIORITY_TONE } from "@/lib/constants";
import { leadPickerTriggerLabel } from "@/lib/base-ui-select-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

function isoFromDateInput(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function todayInputValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function NewFollowupDialog({
  open,
  onOpenChange,
  leads,
  currentUserId,
  onCreate,
  /** When set, the followup is always created for this lead (lead picker hidden). */
  fixedLeadId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  currentUserId: string;
  onCreate: (followup: Followup) => void;
  fixedLeadId?: string;
}) {
  const [leadId, setLeadId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dueDate, setDueDate] = React.useState(todayInputValue());
  const [priority, setPriority] = React.useState<LeadPriority>("medium");

  React.useEffect(() => {
    if (!open) return;
    const lead = fixedLeadId ? leads.find((l) => l.id === fixedLeadId) : leads[0];
    React.startTransition(() => {
      setLeadId(fixedLeadId ?? lead?.id ?? "");
      setTitle(lead ? `Follow up with ${lead.contactName}` : "");
      setDescription("");
      setDueDate(todayInputValue());
      setPriority("medium");
    });
  }, [open, leads, fixedLeadId]);

  const selectedLead = leads.find((l) => l.id === leadId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) {
      toast.error("Add a lead in the workspace before creating a followup.");
      return;
    }
    const t = title.trim();
    if (!t) {
      toast.error("Enter a title for this followup.");
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `f-local-${crypto.randomUUID()}`
        : `f-local-${Date.now()}`;
    const followup: Followup = {
      id,
      leadId: selectedLead.id,
      title: t,
      description: description.trim() || undefined,
      dueAt: isoFromDateInput(dueDate),
      ownerId: selectedLead.ownerId ?? currentUserId,
      priority,
      auto: false,
    };
    onCreate(followup);
    toast.success("Followup created");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New followup</DialogTitle>
            <DialogDescription>
              Create a reminder linked to a lead. Saved in this browser tab until you refresh or leave demo mode.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!fixedLeadId && (
              <div className="grid gap-2">
                <Label htmlFor="followup-lead">Lead</Label>
                <Select
                  value={leadId}
                  onValueChange={(v) => {
                    if (v) setLeadId(v);
                  }}
                  disabled={leads.length === 0}
                >
                  <SelectTrigger id="followup-lead">
                    <SelectValue placeholder="Select a lead">
                      {leadPickerTriggerLabel(leadId, leads) ?? undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.contactName} · {l.companyName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="followup-title">Title</Label>
              <Input
                id="followup-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Send pricing deck"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="followup-desc">Notes (optional)</Label>
              <Textarea
                id="followup-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="followup-due">Due date</Label>
                <Input
                  id="followup-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(v) => {
                    if (v) setPriority(v as LeadPriority);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{PRIORITY_TONE[priority]?.label ?? undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={leads.length === 0}>
              Create followup
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
