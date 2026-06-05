"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Lead, LeadTask, LeadTaskType, LeadTaskVisibility, OrganizationMember, User } from "@/lib/types";
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
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { isAuthDisabled } from "@/lib/auth/flags";
import {
  leadPickerTriggerLabelWithSentinel,
  selectTriggerLabelById,
  selectTriggerLabelByKey,
} from "@/lib/base-ui-select-label";

function isoFromDateInput(dateStr: string): string | undefined {
  if (!dateStr.trim()) return undefined;
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function todayInputValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type AssigneeOption = { id: string; label: string };

function workspaceUsersAsOptions(users: User[]): AssigneeOption[] {
  return users
    .filter((u) => u.status !== "inactive")
    .map((u) => ({
      id: u.id,
      label: u.displayName?.trim() || u.email.split("@")[0] || u.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function activeMemberOptions(members: OrganizationMember[], crmUsers: User[]): AssigneeOption[] {
  const uidToUser = new Map(crmUsers.map((u) => [u.id, u]));
  const opts: AssigneeOption[] = [];
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

const TASK_TYPES: { key: LeadTaskType; label: string }[] = [
  { key: "review", label: "Review" },
  { key: "email", label: "Email / draft" },
  { key: "call", label: "Call" },
  { key: "document", label: "Document" },
  { key: "other", label: "Other" },
];

const LEAD_NONE = "__none__";

const VISIBILITY_TRIGGER: Record<LeadTaskVisibility, string> = {
  on_lead: "Linked to lead",
  assignees_only: "Handoff style",
};

export function NewLeadTaskDialog({
  open,
  onOpenChange,
  leads,
  currentUserId,
  onCreate,
  fixedLeadId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  currentUserId: string;
  onCreate: (task: LeadTask) => void;
  /** When set, task is always tied to this lead (picker hidden). */
  fixedLeadId?: string;
}) {
  const { isDemo, users } = useWorkspace();
  const { user: fbUser } = useAuth();
  const { data: liveUserDoc } = useUserDoc(
    isDemo || isAuthDisabled() || !fbUser ? undefined : fbUser.uid,
  );
  const liveOrgId = !isDemo && liveUserDoc?.organizationId ? liveUserDoc.organizationId : undefined;

  const [assigneeId, setAssigneeId] = React.useState("");
  const [leadId, setLeadId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [taskType, setTaskType] = React.useState<LeadTaskType>("review");
  const [visibility, setVisibility] = React.useState<LeadTaskVisibility>("on_lead");
  const [dueDate, setDueDate] = React.useState("");
  const [assigneeOptions, setAssigneeOptions] = React.useState<AssigneeOption[]>([]);
  const [assigneesLoading, setAssigneesLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (isDemo) {
      setAssigneeOptions(workspaceUsersAsOptions(users));
      setAssigneesLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setAssigneesLoading(true);
    setAssigneeOptions([]);
    void fetch("/api/org/members", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { members?: OrganizationMember[] };
        const members = data.members ?? [];
        if (!cancelled) setAssigneeOptions(activeMemberOptions(members, users));
      })
      .catch(() => {
        if (!cancelled) setAssigneeOptions(workspaceUsersAsOptions(users));
      })
      .finally(() => {
        if (!cancelled) setAssigneesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isDemo, users]);

  React.useEffect(() => {
    if (!open) return;
    const fixed = fixedLeadId ? leads.find((l) => l.id === fixedLeadId) : undefined;
    React.startTransition(() => {
      setLeadId(fixedLeadId ?? leads[0]?.id ?? "");
      setTitle(fixed ? `${TASK_TYPES[0].label}: ${fixed.companyName}` : "");
      setDescription("");
      setTaskType("review");
      setVisibility(fixedLeadId ? "on_lead" : "assignees_only");
      setDueDate("");
      setAssigneeId("");
    });
  }, [open, leads, fixedLeadId]);

  React.useEffect(() => {
    if (!open || assigneeOptions.length === 0) return;
    setAssigneeId((prev) => {
      if (prev && assigneeOptions.some((o) => o.id === prev)) return prev;
      const firstOther = assigneeOptions.find((o) => o.id !== currentUserId);
      return firstOther?.id ?? assigneeOptions[0]!.id;
    });
  }, [open, assigneeOptions, currentUserId]);

  const selectedLead = leadId ? leads.find((l) => l.id === leadId) : undefined;
  const linkedLead = fixedLeadId ? leads.find((l) => l.id === fixedLeadId) : selectedLead;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      toast.error("Enter a short title for this task.");
      return;
    }
    if (!assigneeId) {
      toast.error("Choose someone to assign this task to.");
      return;
    }
    if (assigneeId === currentUserId) {
      toast.error("Assign this task to someone else (you’re already the requester).");
      return;
    }
    const hasLead = Boolean(fixedLeadId ?? leadId);
    if (hasLead && !linkedLead) {
      toast.error("Pick a lead or remove the link.");
      return;
    }
    const vis: LeadTaskVisibility =
      hasLead ? visibility : "assignees_only";

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `lt-local-${crypto.randomUUID()}`
        : `lt-local-${Date.now()}`;
    const iso = new Date().toISOString();
    const task: LeadTask = {
      id,
      leadId: linkedLead?.id,
      title: t,
      description: description.trim() || undefined,
      taskType,
      visibility: vis,
      assigneeId,
      createdById: currentUserId,
      dueAt: isoFromDateInput(dueDate),
      createdAt: iso,
      contextCompany: linkedLead?.companyName,
      contextContact: linkedLead?.contactName,
    };
    onCreate(task);
    toast.success("Task assigned");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Assign a task</DialogTitle>
            <DialogDescription>
              Ask a teammate for a review, email, or other action. Only the assignee, you, and org admins / directors
              can see this task, not other teammates.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Assign to</Label>
              <Select
                value={assigneeId}
                onValueChange={(v) => {
                  if (v) setAssigneeId(v);
                }}
                disabled={assigneesLoading || assigneeOptions.length === 0}
                items={assigneeOptions.map((o) => ({ value: o.id, label: o.label }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={assigneesLoading ? "Loading team…" : "Teammate"}>
                    {selectTriggerLabelById(assigneeId, assigneeOptions) ?? undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {assigneeOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!fixedLeadId && (
              <div className="grid gap-2">
                <Label htmlFor="task-lead">Lead (optional)</Label>
                <Select
                  value={leadId || "__none__"}
                  onValueChange={(v) => {
                    if (!v || v === "__none__") setLeadId("");
                    else setLeadId(v);
                  }}
                  items={[
                    { value: "__none__", label: "No lead, internal task" },
                    ...leads.map((l) => ({
                      value: l.id,
                      label: `${l.contactName} · ${l.companyName}`,
                    })),
                  ]}
                >
                  <SelectTrigger id="task-lead">
                    <SelectValue placeholder="No lead, internal task">
                      {leadPickerTriggerLabelWithSentinel(
                        leadId || LEAD_NONE,
                        LEAD_NONE,
                        "No lead, internal task",
                        leads,
                      ) ?? undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No lead, internal task</SelectItem>
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
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Review pricing paragraph before send"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select
                  value={taskType}
                  onValueChange={(v) => {
                    if (v) setTaskType(v as LeadTaskType);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{selectTriggerLabelByKey(taskType, TASK_TYPES) ?? undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((x) => (
                      <SelectItem key={x.key} value={x.key}>
                        {x.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-due">Due (optional)</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  min={todayInputValue()}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            {(fixedLeadId || leadId) && (
              <div className="grid gap-2">
                <Label>Visibility on lead</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => {
                    if (v) setVisibility(v as LeadTaskVisibility);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{VISIBILITY_TRIGGER[visibility]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on_lead">
                      Linked to lead, shows on this lead’s Tasks tab (still private to assignee, you, admins)
                    </SelectItem>
                    <SelectItem value="assignees_only">
                      Handoff style, same privacy; optional for how you think about the request
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="task-desc">Instructions (optional)</Label>
              <Textarea
                id="task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="resize-none"
                placeholder="What should they deliver?"
              />
            </div>
            {!liveOrgId && !isDemo && (
              <p className="text-xs text-muted-foreground">
                Join an organization so tasks sync to the cloud for your whole team.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={assigneesLoading || assigneeOptions.length === 0}>
              Assign task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
