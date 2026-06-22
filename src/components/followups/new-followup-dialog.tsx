"use client";

import * as React from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import type { Followup, Lead, LeadPriority } from "@/lib/types";
import { PRIORITY_TONE } from "@/lib/constants";
import { leadPickerTriggerLabel } from "@/lib/base-ui-select-label";
import {
  buildWorkspaceOwnerPickerOptions,
  filterLeadsByOwnerScope,
  getOwnerFilterTriggerLabel,
  OWNER_SCOPE_PREFIX,
} from "@/lib/owner-scope";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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

function defaultFollowupTitle(lead: Lead | undefined): string {
  return lead ? `Follow up with ${lead.contactName}` : "";
}

function localYmdFromIso(value: unknown): string {
  if (value == null || value === "") return "";
  const iso =
    typeof value === "string"
      ? value
      : value instanceof Date
        ? value.toISOString()
        : firestoreValueToIso(value);
  if (!iso.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function leadMatchesActivityDate(lead: Lead, ymd: string): boolean {
  if (!ymd) return true;
  const rowYmd = localYmdFromIso(lead.lastActivityAt ?? lead.createdAt);
  return rowYmd === ymd;
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
  const { users, getUserById, getOwnerDisplayName } = useWorkspace();
  const [leadId, setLeadId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dueDate, setDueDate] = React.useState(todayInputValue());
  const [priority, setPriority] = React.useState<LeadPriority>("medium");
  const [leadOwnerScope, setLeadOwnerScope] = React.useState("all-owners");
  const [leadActivityDate, setLeadActivityDate] = React.useState("");

  const leadOwnerIds = React.useMemo(
    () => [...new Set(leads.map((l) => l.ownerId).filter(Boolean))],
    [leads],
  );

  const leadOwnerPickerOptions = React.useMemo(
    () => buildWorkspaceOwnerPickerOptions(users, currentUserId, getOwnerDisplayName, leadOwnerIds),
    [users, currentUserId, getOwnerDisplayName, leadOwnerIds],
  );

  const ownerScopeDeps = React.useMemo(
    () => ({
      currentUserId,
      users,
      getUserById,
      getOwnerDisplayName,
    }),
    [currentUserId, users, getUserById, getOwnerDisplayName],
  );

  const leadOwnerFilterLabel = React.useMemo(
    () => getOwnerFilterTriggerLabel(leadOwnerScope, leadOwnerPickerOptions),
    [leadOwnerScope, leadOwnerPickerOptions],
  );

  const filteredLeads = React.useMemo(() => {
    let rows = filterLeadsByOwnerScope(leads, leadOwnerScope, ownerScopeDeps);
    if (leadActivityDate) {
      rows = rows.filter((l) => leadMatchesActivityDate(l, leadActivityDate));
    }
    return rows;
  }, [leads, leadOwnerScope, leadActivityDate, ownerScopeDeps]);

  React.useEffect(() => {
    if (!open) return;
    const lead = fixedLeadId ? leads.find((l) => l.id === fixedLeadId) : leads[0];
    React.startTransition(() => {
      setLeadId(fixedLeadId ?? lead?.id ?? "");
      setTitle(defaultFollowupTitle(lead));
      setDescription("");
      setDueDate(todayInputValue());
      setPriority("medium");
      setLeadOwnerScope("all-owners");
      setLeadActivityDate("");
    });
  }, [open, leads, fixedLeadId]);

  React.useEffect(() => {
    if (!open || fixedLeadId) return;
    if (filteredLeads.some((l) => l.id === leadId)) return;
    const next = filteredLeads[0];
    const prevLead = leads.find((l) => l.id === leadId);
    const prevDefault = defaultFollowupTitle(prevLead);
    const titleStillSynced = title.trim() === "" || title === prevDefault;
    setLeadId(next?.id ?? "");
    if (next && titleStillSynced) {
      setTitle(defaultFollowupTitle(next));
    }
  }, [open, fixedLeadId, filteredLeads, leadId, leads, title]);

  const selectedLead = filteredLeads.find((l) => l.id === leadId) ?? leads.find((l) => l.id === leadId);

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
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label className="text-xs text-muted-foreground">Team member</Label>
                    <Select
                      value={leadOwnerScope}
                      onValueChange={(v) => setLeadOwnerScope(v ?? "all-owners")}
                      disabled={leads.length === 0}
                    >
                      <SelectTrigger className="h-9 min-w-0">
                        <Users className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                        <SelectValue placeholder="All owners">{leadOwnerFilterLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectGroup>
                          <SelectLabel className="text-[10px] uppercase tracking-wide">Quick</SelectLabel>
                          <SelectItem value="all-owners">All owners</SelectItem>
                          <SelectItem value="me">Owned by me</SelectItem>
                          <SelectItem value="team">My team</SelectItem>
                          <SelectItem value="open-queue">Open queue</SelectItem>
                          <SelectItem value="unassigned">Orphan owner</SelectItem>
                        </SelectGroup>
                        {leadOwnerPickerOptions.length > 0 ? (
                          <>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectLabel className="text-[10px] uppercase tracking-wide">
                                By teammate
                              </SelectLabel>
                              {leadOwnerPickerOptions.map((o) => (
                                <SelectItem key={o.id} value={`${OWNER_SCOPE_PREFIX}${o.id}`}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="followup-lead-activity-date" className="text-xs text-muted-foreground">
                      Activity date
                    </Label>
                    <Input
                      id="followup-lead-activity-date"
                      type="date"
                      className="h-9"
                      value={leadActivityDate}
                      onChange={(e) => setLeadActivityDate(e.target.value)}
                      disabled={leads.length === 0}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="followup-lead">Lead</Label>
                  <Select
                    value={leadId}
                    onValueChange={(v) => {
                      if (!v) return;
                      const prevLead = filteredLeads.find((l) => l.id === leadId);
                      const nextLead = filteredLeads.find((l) => l.id === v);
                      const prevDefault = defaultFollowupTitle(prevLead);
                      const titleStillSynced = title.trim() === "" || title === prevDefault;
                      if (nextLead && titleStillSynced) {
                        setTitle(defaultFollowupTitle(nextLead));
                      }
                      setLeadId(v);
                    }}
                    disabled={filteredLeads.length === 0}
                  >
                    <SelectTrigger id="followup-lead">
                      <SelectValue placeholder="Select a lead">
                        {leadPickerTriggerLabel(leadId, filteredLeads) ?? undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {filteredLeads.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.contactName} · {l.companyName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {leads.length > 0 && filteredLeads.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No leads match these filters. Try another teammate or clear the activity date.
                    </p>
                  ) : filteredLeads.length < leads.length ? (
                    <p className="text-xs text-muted-foreground">
                      Showing {filteredLeads.length} of {leads.length} leads. Leave activity date empty to include
                      all days.
                    </p>
                  ) : null}
                </div>
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
            <Button type="submit" disabled={!selectedLead}>
              Create followup
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
