"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  applyContactEmailUpdate,
  buildEmailChangeTimelineEvents,
  openBounceReviewTasksForLead,
  type ContactEmailField,
} from "@/lib/email/contact-email-change";
import type { Contact, Lead } from "@/lib/types";

export function UpdateContactEmailDialog({
  open,
  onOpenChange,
  lead,
  contact,
  suggestedEmail,
  reason = "manual",
  /** When true (bounce + paused plan), offer one-click resume with same copy. */
  canResumeSequence = false,
  onResumeSequence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  contact: Contact;
  /** Prefill when an auto-reply suggested a replacement address. */
  suggestedEmail?: string;
  reason?: "bounce" | "suggested" | "manual";
  canResumeSequence?: boolean;
  /** Called after email save when user opts to resume; receives the new To address. */
  onResumeSequence?: (to: string) => Promise<void>;
}) {
  const ws = useWorkspace();
  const [field, setField] = React.useState<ContactEmailField>("email");
  const [nextEmail, setNextEmail] = React.useState("");
  const [resumeSequence, setResumeSequence] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setField("email");
    setNextEmail(suggestedEmail?.trim() || "");
    setResumeSequence(canResumeSequence);
  }, [open, suggestedEmail, contact.id, canResumeSequence]);

  const currentValue = field === "email" ? contact.email : contact.personalEmail;
  const bounced = contact.emailVerificationStatus === "bounced";
  const showResume = reason === "bounce" && canResumeSequence && Boolean(onResumeSequence);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nextEmail.trim();
    if (!trimmed || !trimmed.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    if (trimmed.toLowerCase() === (currentValue ?? "").trim().toLowerCase()) {
      toast.error("That is already the current email");
      return;
    }

    setBusy(true);
    try {
      const { contactPatch, leadPatch, changes } = applyContactEmailUpdate({
        contact,
        lead,
        field,
        nextEmail: trimmed,
      });
      if (changes.length === 0) {
        toast.error("No email change detected");
        return;
      }

      const nextLeadPatch: Partial<Lead> = {
        ...leadPatch,
        suggestLinkedInSequence: false,
      };

      ws.patchContact(contact.id, contactPatch);
      if (Object.keys(nextLeadPatch).length > 0) {
        ws.patchLead(lead.id, nextLeadPatch);
      }
      ws.bumpLeadActivity(lead.id);

      for (const event of buildEmailChangeTimelineEvents({
        leadId: lead.id,
        actorId: ws.currentUserId,
        changes,
      })) {
        ws.addTimelineEvent(event);
      }

      for (const task of openBounceReviewTasksForLead(ws.leadTasks, lead.id)) {
        ws.setLeadTaskCompleted(task.id, true);
      }

      if (showResume && resumeSequence && onResumeSequence) {
        try {
          await onResumeSequence(trimmed);
          toast.success("Email fixed and sequence resumed", {
            description: changes.map((c) => `${c.from} → ${c.to}`).join(" · "),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not reschedule sequence";
          toast.error("Email updated, but sequence resume failed", { description: msg });
        }
      } else {
        toast.success(
          reason === "bounce"
            ? "Bounced email replaced"
            : reason === "suggested"
              ? "Contact email updated from reply"
              : "Contact email updated",
          { description: changes.map((c) => `${c.from} → ${c.to}`).join(" · ") },
        );
      }
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <form onSubmit={(e) => void handleSave(e)}>
          <DialogHeader>
            <DialogTitle>
              {reason === "bounce"
                ? showResume
                  ? "Fix email & resume sequence"
                  : "Update bounced email"
                : reason === "suggested"
                  ? "Use suggested email"
                  : "Update contact email"}
            </DialogTitle>
            <DialogDescription>
              {reason === "bounce"
                ? showResume
                  ? "Replace the bounced address and reschedule remaining steps with the same copy — no AI regenerate needed."
                  : "Replace the bounced address so outreach can resume. The change is logged on the timeline."
                : reason === "suggested"
                  ? "Apply the address from their reply. Old → new is logged on the timeline."
                  : "Change the company or personal email. Old → new is logged on the timeline."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-3">
            {bounced && contact.email ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Bounced: {contact.email}
                {contact.emailBouncedAt
                  ? ` · ${new Date(contact.emailBouncedAt).toLocaleDateString()}`
                  : ""}
              </p>
            ) : null}

            <div className="grid gap-1.5">
              <Label>Which email</Label>
              <Select
                value={field}
                onValueChange={(v) => v && setField(v as ContactEmailField)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">
                    Company email{contact.email ? ` (${contact.email})` : ""}
                  </SelectItem>
                  <SelectItem value="personalEmail">
                    Personal email{contact.personalEmail ? ` (${contact.personalEmail})` : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="update-contact-email">New email</Label>
              <Input
                id="update-contact-email"
                type="email"
                value={nextEmail}
                onChange={(e) => setNextEmail(e.target.value)}
                placeholder="name@company.com"
                autoFocus
                required
              />
              {currentValue ? (
                <p className="text-[11px] text-muted-foreground">Current: {currentValue}</p>
              ) : null}
            </div>

            {showResume ? (
              <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={resumeSequence}
                  onChange={(e) => setResumeSequence(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-foreground">Resume sequence with same copy</span>
                  <span className="block text-muted-foreground mt-0.5">
                    Recompute dates (Day 0 → +3 → +5 → +7 business days) and re-queue remaining
                    emails to this address. Uncheck to only update the contact.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {showResume && resumeSequence ? "Save & resume" : "Save email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
