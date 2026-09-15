"use client";

import * as React from "react";
import { toast } from "sonner";
import { UserRoundPlus, Users } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { findContactByEmail } from "@/lib/crm-dedupe";
import { openBounceReviewTasksForLead } from "@/lib/email/contact-email-change";
import {
  applyLeadContactSwitch,
  buildLeadContactSwitchTimelineEvent,
  siblingContactsOnAccount,
} from "@/lib/leads/switch-lead-contact";
import type { BuyerPersona } from "@/lib/prospecting-strategy/types";
import type { Account, Contact, Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

function newContactId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ct-${crypto.randomUUID()}`;
  }
  return `ct-${Date.now()}`;
}

type Mode = "pick" | "create";

export function SwitchLeadContactDialog({
  open,
  onOpenChange,
  lead,
  contact,
  account,
  personas = [],
  canResumeSequence = false,
  onResumeSequence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  contact: Contact;
  account: Account;
  personas?: readonly BuyerPersona[];
  canResumeSequence?: boolean;
  onResumeSequence?: (to: string) => Promise<void>;
}) {
  const ws = useWorkspace();
  const siblings = siblingContactsOnAccount(ws.contacts, lead.accountId, lead.contactId);

  const [mode, setMode] = React.useState<Mode>("pick");
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [personaId, setPersonaId] = React.useState<string>("");
  const [resumeSequence, setResumeSequence] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [personalEmail, setPersonalEmail] = React.useState("");
  const [linkedin, setLinkedin] = React.useState("");

  // Seed once per open — sibling list / resume flag churn must not wipe create-mode fields.
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    const nextMode: Mode = siblings.length > 0 ? "pick" : "create";
    setMode(nextMode);
    setSelectedId(siblings[0]?.id ?? "");
    setPersonaId(lead.personaId ?? "");
    setResumeSequence(canResumeSequence);
    setFirstName("");
    setLastName("");
    setTitle("");
    setEmail("");
    setPersonalEmail("");
    setLinkedin("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- siblings identity changes every render
  }, [open, lead.id, lead.contactId, lead.personaId, account.id, canResumeSequence, siblings.length]);

  async function resolveTargetContact(): Promise<Contact> {
    if (mode === "pick") {
      const picked = siblings.find((c) => c.id === selectedId);
      if (!picked) throw new Error("Select a contact at this company");
      return picked;
    }

    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last) throw new Error("First and last name are required");

    const trimmedEmail = email.trim();
    const trimmedPersonal = personalEmail.trim();
    if (trimmedEmail && findContactByEmail(ws.contacts, trimmedEmail)) {
      throw new Error("A contact with this company email already exists");
    }
    if (trimmedPersonal && findContactByEmail(ws.contacts, trimmedPersonal)) {
      throw new Error("A contact with this personal email already exists");
    }
    if (!trimmedEmail && !trimmedPersonal && !linkedin.trim()) {
      throw new Error("Add an email or LinkedIn URL for the new person");
    }

    const ownerId = ws.currentUserId || ws.users[0]?.id;
    if (!ownerId) throw new Error("Could not assign an owner");

    const now = new Date().toISOString();
    const created: Contact = {
      id: newContactId(),
      accountId: account.id,
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`.trim(),
      email: trimmedEmail || undefined,
      personalEmail: trimmedPersonal || undefined,
      title: title.trim() || undefined,
      linkedin: linkedin.trim() || undefined,
      ownerId,
      createdAt: now,
      updatedAt: now,
    };
    await ws.addContact(created);
    return created;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const toContact = await resolveTargetContact();
      const { leadPatch, timelineSummary, resumeToEmail } = applyLeadContactSwitch({
        lead,
        fromContact: contact,
        toContact,
        personaId: personaId || null,
      });

      await ws.patchLeadAsync(lead.id, leadPatch);
      ws.bumpLeadActivity(lead.id);

      ws.addTimelineEvent(
        buildLeadContactSwitchTimelineEvent({
          leadId: lead.id,
          actorId: ws.currentUserId,
          fromContactId: contact.id,
          toContactId: toContact.id,
          fromName: contact.fullName,
          toName: toContact.fullName,
          summary: timelineSummary,
        }),
      );

      for (const task of openBounceReviewTasksForLead(ws.leadTasks, lead.id)) {
        ws.setLeadTaskCompleted(task.id, true);
      }

      const shouldResume =
        canResumeSequence &&
        resumeSequence &&
        Boolean(onResumeSequence) &&
        Boolean(resumeToEmail);

      if (shouldResume && onResumeSequence && resumeToEmail) {
        try {
          await onResumeSequence(resumeToEmail);
          toast.success("Contact switched and sequence resumed", {
            description: `${contact.fullName} → ${toContact.fullName} · ${resumeToEmail}`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not reschedule sequence";
          toast.error("Contact switched, but sequence resume failed", { description: msg });
        }
      } else {
        toast.success("Outreach contact switched", {
          description: resumeToEmail
            ? `${contact.fullName} → ${toContact.fullName}. You can resume or start a new sequence.`
            : `${contact.fullName} → ${toContact.fullName}. Add a valid email to continue email outreach.`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch contact");
    } finally {
      setBusy(false);
    }
  }

  const showResume =
    canResumeSequence && Boolean(onResumeSequence) && (mode === "pick" ? Boolean(selectedId) : true);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Switch contact at this company</DialogTitle>
            <DialogDescription>
              Keep {account.name} as the opportunity. Replace{" "}
              <span className="font-medium text-foreground">{contact.fullName}</span> with another
              person. The bounced contact stays on the account for history.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "pick" ? "default" : "outline"}
                disabled={siblings.length === 0}
                onClick={() => setMode("pick")}
              >
                <Users className="h-3.5 w-3.5" />
                Existing contact
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "create" ? "default" : "outline"}
                onClick={() => setMode("create")}
              >
                <UserRoundPlus className="h-3.5 w-3.5" />
                New person
              </Button>
            </div>

            {mode === "pick" ? (
              siblings.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  No other contacts on this company yet. Create a new person instead.
                </p>
              ) : (
                <RadioGroup
                  value={selectedId}
                  onValueChange={setSelectedId}
                  className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2"
                >
                  {siblings.map((c) => {
                    const emailLabel = c.email || c.personalEmail || "No email";
                    const bounced = c.emailVerificationStatus === "bounced";
                    return (
                      <label
                        key={c.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60",
                          selectedId === c.id && "bg-muted",
                        )}
                      >
                        <RadioGroupItem value={c.id} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{c.fullName}</span>
                          {c.title ? (
                            <span className="text-muted-foreground"> · {c.title}</span>
                          ) : null}
                          <span className="block text-xs text-muted-foreground">
                            {emailLabel}
                            {bounced ? " · bounced" : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </RadioGroup>
              )
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="switch-contact-first">First name</Label>
                  <Input
                    id="switch-contact-first"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="switch-contact-last">Last name</Label>
                  <Input
                    id="switch-contact-last"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="switch-contact-title">Title</Label>
                  <Input
                    id="switch-contact-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Head of Operations"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="switch-contact-email">Company email</Label>
                  <Input
                    id="switch-contact-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="switch-contact-personal">Personal email</Label>
                  <Input
                    id="switch-contact-personal"
                    type="email"
                    value={personalEmail}
                    onChange={(e) => setPersonalEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="switch-contact-linkedin">LinkedIn URL</Label>
                  <Input
                    id="switch-contact-linkedin"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="https://linkedin.com/in/…"
                  />
                </div>
              </div>
            )}

            {personas.length > 0 ? (
              <div className="grid gap-1.5">
                <Label>Buyer persona (optional)</Label>
                <Select
                  value={personaId || "__keep__"}
                  onValueChange={(v) => setPersonaId(!v || v === "__keep__" ? lead.personaId ?? "" : v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Keep current persona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__keep__">Keep current persona</SelectItem>
                    <SelectItem value="__none__">No persona</SelectItem>
                    {personas.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Change only if the new person is a different ICP role.
                </p>
              </div>
            ) : null}

            {showResume ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={resumeSequence}
                  onChange={(e) => setResumeSequence(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-foreground">
                    Resume paused sequence with same copy
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Re-queue remaining steps to the new person&apos;s email when available. Uncheck
                    to only switch the contact (start a fresh sequence later).
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (mode === "pick" && !selectedId)}>
              {showResume && resumeSequence ? "Switch & resume" : "Switch contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
