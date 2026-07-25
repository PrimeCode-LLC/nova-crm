"use client";

import { Link2, MailWarning, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contactHasBouncedEmail } from "@/lib/email/contact-email-change";
import type { Contact } from "@/lib/types";

export function LeadContactEmailActionBanner({
  contact,
  suggestedEmail,
  canEdit,
  onUpdateEmail,
  suggestLinkedInSequence = false,
  hasLinkedIn = false,
  onBuildLinkedInSequence,
}: {
  contact: Contact | undefined;
  suggestedEmail?: string | null;
  canEdit: boolean;
  onUpdateEmail: (opts: { reason: "bounce" | "suggested"; suggestedEmail?: string }) => void;
  /** After 2nd hard bounce with LinkedIn URL. */
  suggestLinkedInSequence?: boolean;
  hasLinkedIn?: boolean;
  onBuildLinkedInSequence?: () => void;
}) {
  const bounced = contactHasBouncedEmail(contact);
  const suggested = suggestedEmail?.trim() || "";

  if (!bounced && !suggested && !suggestLinkedInSequence) return null;

  if (suggestLinkedInSequence && hasLinkedIn && onBuildLinkedInSequence) {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 space-y-2">
        <div className="flex items-start gap-2">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-400" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">Email channel exhausted</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Two hard bounces on this lead. A LinkedIn profile is on file. Build a LinkedIn
              sequence to continue outreach (review copy before sending).
            </p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 pl-6">
            <Button type="button" size="sm" onClick={onBuildLinkedInSequence}>
              <Link2 className="h-3.5 w-3.5" />
              Build LinkedIn sequence
            </Button>
            {bounced ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  onUpdateEmail({
                    reason: "bounce",
                    suggestedEmail: suggested || undefined,
                  })
                }
              >
                Fix email instead
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (bounced) {
    const hasPersonal = Boolean(contact?.personalEmail?.trim());
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 space-y-2">
        <div className="flex items-start gap-2">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">Email bounced</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {hasPersonal
                ? `${contact?.email ?? "Company email"} bounced. Outreach can continue on personal (${contact?.personalEmail}), or replace the company address.`
                : contact?.email
                  ? `${contact.email} is marked bounced. Replace it with a valid address to resume the sequence with the same copy.`
                  : "This contact’s email bounced. Add a valid address to continue outreach."}
              {suggested ? (
                <>
                  {" "}
                  Reply suggested <span className="font-medium text-foreground">{suggested}</span>.
                </>
              ) : null}
            </p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 pl-6">
            <Button
              type="button"
              size="sm"
              onClick={() =>
                onUpdateEmail({
                  reason: "bounce",
                  suggestedEmail: suggested || undefined,
                })
              }
            >
              {hasPersonal ? "Update company email" : "Fix email & resume"}
            </Button>
            {suggested ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onUpdateEmail({ reason: "suggested", suggestedEmail: suggested })}
              >
                Use {suggested}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">New email suggested in a reply</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Someone mentioned <span className="font-medium text-foreground">{suggested}</span>. Update
            the contact record so outreach uses the right address.
          </p>
        </div>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Button
            type="button"
            size="sm"
            onClick={() => onUpdateEmail({ reason: "suggested", suggestedEmail: suggested })}
          >
            Use {suggested}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onUpdateEmail({ reason: "suggested", suggestedEmail: suggested })}
          >
            Edit email
          </Button>
        </div>
      ) : null}
    </div>
  );
}
