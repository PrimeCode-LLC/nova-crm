"use client";

import * as React from "react";
import { Loader2, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import type { Followup, FollowupChannel, Lead, LeadPriority } from "@/lib/types";
import { PRIORITY_TONE } from "@/lib/constants";
import { demoFollowupSuggestions } from "@/lib/ai/demo-followup-suggestions";
import { leadPickerTriggerLabel } from "@/lib/base-ui-select-label";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { channelLabelFromValue } from "@/lib/channel-options";
import {
  buildWorkspaceOwnerPickerOptions,
  filterLeadsByOwnerScope,
  getOwnerFilterTriggerLabel,
  OWNER_SCOPE_PREFIX,
} from "@/lib/owner-scope";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import { todayDateInputValue } from "@/lib/followup-date";
import { channelMixForFollowupChannel } from "@/lib/followup-plans";
import {
  datetimeLocalInZone,
  isoFromDatetimeLocalInZone,
  zonedDayKey,
} from "@/lib/org-timezone";
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

/** Default wall-clock time when creating a reminder (matches prior noon-of-day storage). */
const DEFAULT_DUE_TIME = "12:00";

function defaultFollowupTitle(lead: Lead | undefined): string {
  return lead ? `Follow up with ${lead.contactName}` : "";
}

function isoFromUnknown(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return firestoreValueToIso(value);
}

function ymdFromIso(value: unknown, timeZone: string): string {
  const iso = isoFromUnknown(value);
  if (!iso.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return zonedDayKey(d, timeZone);
}

function hmFromIso(value: unknown, timeZone: string): string {
  const iso = isoFromUnknown(value);
  if (!iso.trim()) return DEFAULT_DUE_TIME;
  const local = datetimeLocalInZone(iso, timeZone);
  const hm = local.split("T")[1];
  return hm && /^\d{2}:\d{2}$/.test(hm) ? hm : DEFAULT_DUE_TIME;
}

function dueAtFromDateAndTime(dueDate: string, dueTime: string, timeZone: string): string {
  const hm = /^\d{1,2}:\d{2}$/.test(dueTime.trim()) ? dueTime.trim() : DEFAULT_DUE_TIME;
  return isoFromDatetimeLocalInZone(`${dueDate}T${hm}`, timeZone);
}

function leadMatchesActivityDate(lead: Lead, ymd: string, timeZone: string): boolean {
  if (!ymd) return true;
  const rowYmd = ymdFromIso(lead.lastActivityAt ?? lead.createdAt, timeZone);
  return rowYmd === ymd;
}

export type FollowupEditableFields = Pick<
  Followup,
  | "title"
  | "description"
  | "messageBody"
  | "emailSubject"
  | "channel"
  | "dueAt"
  | "priority"
  | "ownerId"
>;

export function NewFollowupDialog({
  open,
  onOpenChange,
  leads,
  currentUserId,
  onCreate,
  /** When set, the dialog edits this followup instead of creating. */
  editFollowup,
  onUpdate,
  /** When set, the followup is always created for this lead (lead picker hidden). */
  fixedLeadId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  currentUserId: string;
  onCreate?: (followup: Followup) => void;
  editFollowup?: Followup | null;
  onUpdate?: (id: string, patch: Partial<FollowupEditableFields>) => void;
  fixedLeadId?: string;
}) {
  const { users, getUserById, getOwnerDisplayName, isDemo } = useWorkspace();
  const timeZone = useOrgTimezone();
  const channelOptions = useChannelOptions();
  const isEdit = Boolean(editFollowup);
  const [leadId, setLeadId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [messageBody, setMessageBody] = React.useState("");
  const [emailSubject, setEmailSubject] = React.useState("");
  const [channel, setChannel] = React.useState<FollowupChannel | "">("");
  const [dueDate, setDueDate] = React.useState(() => todayDateInputValue(timeZone));
  const [dueTime, setDueTime] = React.useState(DEFAULT_DUE_TIME);
  const [priority, setPriority] = React.useState<LeadPriority>("medium");
  const [leadOwnerScope, setLeadOwnerScope] = React.useState("all-owners");
  const [leadActivityDate, setLeadActivityDate] = React.useState("");
  const [isRegenerating, setIsRegenerating] = React.useState(false);

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
      rows = rows.filter((l) => leadMatchesActivityDate(l, leadActivityDate, timeZone));
    }
    return rows;
  }, [leads, leadOwnerScope, leadActivityDate, ownerScopeDeps, timeZone]);

  React.useEffect(() => {
    if (!open) return;
    if (editFollowup) {
      React.startTransition(() => {
        setLeadId(editFollowup.leadId ?? fixedLeadId ?? "");
        setTitle(editFollowup.title);
        setDescription(editFollowup.description ?? "");
        setMessageBody(editFollowup.messageBody ?? "");
        setEmailSubject(editFollowup.emailSubject ?? "");
        setChannel(editFollowup.channel ?? "");
        setDueDate(ymdFromIso(editFollowup.dueAt, timeZone) || todayDateInputValue(timeZone));
        setDueTime(hmFromIso(editFollowup.dueAt, timeZone));
        setPriority(editFollowup.priority);
        setLeadOwnerScope("all-owners");
        setLeadActivityDate("");
      });
      return;
    }
    const lead = fixedLeadId ? leads.find((l) => l.id === fixedLeadId) : leads[0];
    React.startTransition(() => {
      setLeadId(fixedLeadId ?? lead?.id ?? "");
      setTitle(defaultFollowupTitle(lead));
      setDescription("");
      setMessageBody("");
      setEmailSubject("");
      setChannel("");
      setDueDate(todayDateInputValue(timeZone));
      setDueTime(DEFAULT_DUE_TIME);
      setPriority("medium");
      setLeadOwnerScope("all-owners");
      setLeadActivityDate("");
    });
  }, [open, leads, fixedLeadId, editFollowup, timeZone]);

  React.useEffect(() => {
    if (!open || fixedLeadId || isEdit) return;
    if (filteredLeads.some((l) => l.id === leadId)) return;
    const next = filteredLeads[0];
    const prevLead = leads.find((l) => l.id === leadId);
    const prevDefault = defaultFollowupTitle(prevLead);
    const titleStillSynced = title.trim() === "" || title === prevDefault;
    React.startTransition(() => {
      setLeadId(next?.id ?? "");
      if (next && titleStillSynced) {
        setTitle(defaultFollowupTitle(next));
      }
    });
  }, [open, fixedLeadId, isEdit, filteredLeads, leadId, leads, title]);

  const selectedLead =
    filteredLeads.find((l) => l.id === leadId) ?? leads.find((l) => l.id === leadId);

  async function regenerateStep() {
    if (!editFollowup || !selectedLead) {
      toast.error("This followup is not linked to an available lead.");
      return;
    }

    setIsRegenerating(true);
    const currentStep = [
      `Current title: ${title.trim()}`,
      `Current notes: ${description.trim() || "(none)"}`,
      `Current channel: ${channel || "(none)"}`,
      `Current email subject: ${emailSubject.trim() || "(none)"}`,
      `Current message: ${messageBody.trim() || "(none)"}`,
    ]
      .join("\n")
      .slice(0, 800);

    try {
      const res = await fetch("/api/ai/followup-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selectedLead.id,
          sequenceMode: "continue",
          singleStep: true,
          // Keep the replacement on this step's own channel, not the lead's default.
          channelMix: channelMixForFollowupChannel(channel || undefined, selectedLead.channel),
          userPrompt: "Rewrite this one follow-up step with fresh, personalized copy.",
          regenerateContext: currentStep,
          demoContext: isDemo ? { lead: selectedLead } : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: unknown;
        items?: Array<{
          title: string;
          description?: string;
          emailSubject?: string;
          messageBody: string;
        }>;
      };
      let item = data.items?.[0];

      if (!res.ok && isDemo) {
        item = demoFollowupSuggestions(selectedLead, currentStep, "continue").items[0];
      } else if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not regenerate this step");
      }
      if (!item) throw new Error("AI did not return a replacement step");

      setTitle(item.title);
      setDescription(item.description ?? "");
      setEmailSubject(item.emailSubject ?? "");
      setMessageBody(item.messageBody);
      toast.success("Step regenerated. Review before saving.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not regenerate this step");
    } finally {
      setIsRegenerating(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      toast.error("Enter a title for this followup.");
      return;
    }

    if (!dueDate) {
      toast.error("Pick a due date.");
      return;
    }

    const dueAt = dueAtFromDateAndTime(dueDate, dueTime, timeZone);

    if (isEdit && editFollowup && onUpdate) {
      const patch: Partial<FollowupEditableFields> = {
        title: t,
        description: description.trim(),
        messageBody: messageBody.trim(),
        emailSubject: emailSubject.trim(),
        channel: channel || undefined,
        dueAt,
        priority,
        ownerId: editFollowup.ownerId,
      };
      onUpdate(editFollowup.id, patch);
      toast.success("Followup updated");
      onOpenChange(false);
      return;
    }

    if (!selectedLead) {
      toast.error("Add a lead in the workspace before creating a followup.");
      return;
    }
    if (!onCreate) return;

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `f-local-${crypto.randomUUID()}`
        : `f-local-${Date.now()}`;
    const followup: Followup = {
      id,
      leadId: selectedLead.id,
      title: t,
      description: description.trim() || undefined,
      messageBody: messageBody.trim() || undefined,
      emailSubject: emailSubject.trim() || undefined,
      channel: channel || undefined,
      dueAt,
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
            <DialogTitle>{isEdit ? "Edit reminder" : "Add reminder"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the reminder details. Changing due date, time, or message cancels any pending scheduled email."
                : "Create a one-off reminder linked to this lead."}
            </DialogDescription>
          </DialogHeader>
          {isEdit && editFollowup && (editFollowup.fromEmail || editFollowup.toEmail) ? (
            <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              {editFollowup.scheduledEmailId
                ? "Queued from "
                : "Last used "}
              {editFollowup.fromEmail ? (
                <span className="font-medium text-foreground">{editFollowup.fromEmail}</span>
              ) : (
                "mailbox"
              )}
              {editFollowup.toEmail ? (
                <>
                  {" "}
                  → <span className="font-medium text-foreground">{editFollowup.toEmail}</span>
                </>
              ) : null}
              {!editFollowup.scheduledEmailId
                ? ". Re-schedule to keep sending from the same mailbox."
                : ". Changing due date, time, or message cancels the queue — then re-schedule with the same From."}
            </p>
          ) : null}
          <div className="grid gap-4 py-2">
            {!fixedLeadId && !isEdit && (
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
            {isEdit || messageBody || channel ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="followup-email-subject">Email subject (optional)</Label>
                  <Input
                    id="followup-email-subject"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Used when scheduling email"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="followup-message">Message body (optional)</Label>
                  <Textarea
                    id="followup-message"
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    rows={4}
                    className="resize-y font-mono text-xs"
                    placeholder="Copy-ready outreach message…"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Channel (optional)</Label>
                  <Select
                    value={channel || "__none__"}
                    onValueChange={(v) => {
                      if (!v || v === "__none__") setChannel("");
                      else setChannel(v as FollowupChannel);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any channel">
                        {channel
                          ? channelLabelFromValue(channel, channelOptions) || channel
                          : "Any channel"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any channel</SelectItem>
                      {channelOptions.map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}
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
                <Label htmlFor="followup-due-time">Due time</Label>
                <Input
                  id="followup-due-time"
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </div>
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
          <DialogFooter className={isEdit ? "sm:justify-between" : undefined}>
            {isEdit ? (
              <Button
                type="button"
                variant="outline"
                disabled={isRegenerating || !selectedLead}
                onClick={() => void regenerateStep()}
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Regenerating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" /> Regenerate step
                  </>
                )}
              </Button>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isRegenerating || (!isEdit && !selectedLead)}>
                {isEdit ? "Save changes" : "Add reminder"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
