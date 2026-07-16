"use client";

import * as React from "react";
import { mailboxSignatureTrimmed } from "@/lib/email/append-mailbox-signature";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** Read-only preview of the selected mailbox signature for schedule dialogs. */
export function MailboxSignaturePreview({
  signature,
  includeSignature,
  onIncludeChange,
  mailboxLabel,
  id = "include-mailbox-signature",
}: {
  signature: string | undefined | null;
  includeSignature: boolean;
  onIncludeChange: (include: boolean) => void;
  mailboxLabel?: string;
  id?: string;
}) {
  const trimmed = mailboxSignatureTrimmed(signature);

  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/20 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Checkbox
          id={id}
          checked={includeSignature}
          onCheckedChange={(v) => onIncludeChange(v === true)}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={id} className="text-xs font-medium cursor-pointer">
            Append mailbox signature
            {mailboxLabel ? (
              <span className="font-normal text-muted-foreground"> · {mailboxLabel}</span>
            ) : null}
          </Label>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Set per account in Settings → Email. Message body stays clean; signature is added when
            this email is queued.
          </p>
        </div>
      </div>
      {includeSignature ? (
        trimmed ? (
          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded border bg-background/80 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
            {trimmed}
          </pre>
        ) : (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            No signature on this mailbox. Add one in Settings → Email, or leave this off.
          </p>
        )
      ) : null}
    </div>
  );
}
