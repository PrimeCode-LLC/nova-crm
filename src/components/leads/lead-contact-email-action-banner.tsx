"use client";

import * as React from "react";
import { MailWarning, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contactHasBouncedEmail } from "@/lib/email/contact-email-change";
import type { Contact } from "@/lib/types";

export function LeadContactEmailActionBanner({
  contact,
  suggestedEmail,
  canEdit,
  onUpdateEmail,
}: {
  contact: Contact | undefined;
  suggestedEmail?: string | null;
  canEdit: boolean;
  onUpdateEmail: (opts: { reason: "bounce" | "suggested"; suggestedEmail?: string }) => void;
}) {
  const bounced = contactHasBouncedEmail(contact);
  const suggested = suggestedEmail?.trim() || "";

  if (!bounced && !suggested) return null;

  if (bounced) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 space-y-2">
        <div className="flex items-start gap-2">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">Email bounced</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {contact?.email
                ? `${contact.email} is marked bounced. Replace it with a valid address to continue outreach.`
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
              Update email
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
