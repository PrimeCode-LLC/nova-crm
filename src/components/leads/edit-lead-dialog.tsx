"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Lead, LeadPriority, LeadTemperature, PipelineStage } from "@/lib/types";
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
import { PIPELINE_STAGES, TEMPERATURE_TONE, PRIORITY_TONE } from "@/lib/constants";

function isoFromDateInput(dateStr: string): string | undefined {
  if (!dateStr.trim()) return undefined;
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function dateInputFromIso(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function EditLeadDialog({
  open,
  onOpenChange,
  lead,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSave: (patch: Partial<Lead>) => void;
}) {
  const [stage, setStage] = React.useState<PipelineStage>("new");
  const [temperature, setTemperature] = React.useState<LeadTemperature>("cold");
  const [priority, setPriority] = React.useState<LeadPriority>("medium");
  const [nextAction, setNextAction] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [estimatedValue, setEstimatedValue] = React.useState("");
  const [expectedClose, setExpectedClose] = React.useState("");

  React.useEffect(() => {
    if (!open || !lead) return;
    React.startTransition(() => {
      setStage(lead.stage);
      setTemperature(lead.temperature);
      setPriority(lead.priority);
      setNextAction(lead.nextAction ?? "");
      setNotes(lead.notes ?? "");
      setEstimatedValue(lead.estimatedValue != null ? String(lead.estimatedValue) : "");
      setExpectedClose(dateInputFromIso(lead.expectedCloseDate));
    });
  }, [open, lead]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    const evRaw = estimatedValue.trim();
    let estimatedValueNum: number | undefined;
    if (evRaw) {
      const n = Number(evRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Estimated value must be a valid number.");
        return;
      }
      estimatedValueNum = n;
    } else {
      estimatedValueNum = undefined;
    }
    const expectedCloseDate = isoFromDateInput(expectedClose);
    onSave({
      stage,
      temperature,
      priority,
      nextAction: nextAction.trim() || undefined,
      notes: notes.trim() || undefined,
      estimatedValue: estimatedValueNum,
      expectedCloseDate,
    });
    toast.success("Lead updated");
    onOpenChange(false);
  }

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
            <DialogDescription>
              Update qualification and next steps for {lead.contactName}. Changes apply for this browser session.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 max-h-[min(70vh,520px)] overflow-y-auto pr-1">
            <div className="grid gap-2">
              <Label>Stage</Label>
              <Select value={stage} onValueChange={(v) => v && setStage(v as PipelineStage)}>
                <SelectTrigger>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Temperature</Label>
                <Select value={temperature} onValueChange={(v) => v && setTemperature(v as LeadTemperature)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TEMPERATURE_TONE) as LeadTemperature[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {TEMPERATURE_TONE[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => v && setPriority(v as LeadPriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_TONE) as LeadPriority[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {PRIORITY_TONE[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-next">Next action</Label>
              <Input
                id="edit-next"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="e.g. Send proposal deck by Friday"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-notes">Internal notes</Label>
              <Textarea
                id="edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="resize-none"
                placeholder="Team-only context…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="edit-ev">Est. value (USD)</Label>
                <Input
                  id="edit-ev"
                  inputMode="decimal"
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-close">Expected close</Label>
                <Input
                  id="edit-close"
                  type="date"
                  value={expectedClose}
                  onChange={(e) => setExpectedClose(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
