"use client";

import * as React from "react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
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
import { findContactByEmail } from "@/lib/crm-dedupe";
import type { Account } from "@/lib/types";

function newContactId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ct-${crypto.randomUUID()}`;
  }
  return `ct-${Date.now()}`;
}

export function AddAccountContactDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
}) {
  const { addContact, contacts, currentUserId, users } = useWorkspace();
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    React.startTransition(() => {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setTitle("");
      setSaving(false);
    });
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last) {
      toast.error("First and last name are required.");
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail && findContactByEmail(contacts, trimmedEmail)) {
      toast.error("A contact with this email already exists.");
      return;
    }

    const ownerId = currentUserId || users[0]?.id;
    if (!ownerId) {
      toast.error("Could not assign an owner. Try again after refresh.");
      return;
    }

    const now = new Date().toISOString();
    setSaving(true);
    try {
      await addContact({
        id: newContactId(),
        accountId: account.id,
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`.trim(),
        email: trimmedEmail || undefined,
        phone: phone.trim() || undefined,
        title: title.trim() || undefined,
        ownerId,
        createdAt: now,
        updatedAt: now,
      });
      toast.success("Contact created");
      onOpenChange(false);
    } catch {
      // The workspace provider displays persistence errors.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add contact</DialogTitle>
            <DialogDescription>Create a contact for {account.name}.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="account-contact-first">First name</Label>
              <Input
                id="account-contact-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-contact-last">Last name</Label>
              <Input
                id="account-contact-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="account-contact-title">Title</Label>
              <Input
                id="account-contact-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="CEO"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-contact-email">Email</Label>
              <Input
                id="account-contact-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-contact-phone">Phone</Label>
              <Input
                id="account-contact-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
