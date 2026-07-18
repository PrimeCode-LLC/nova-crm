"use client";

import * as React from "react";
import { globalEmailFooterTrimmed } from "@/lib/email/append-mailbox-signature";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** Read-only preview of the account-wide email footer for schedule dialogs. */
export function GlobalEmailFooterPreview({
  footer,
  includeFooter,
  onIncludeChange,
  id = "include-global-email-footer",
}: {
  footer: string | undefined | null;
  includeFooter: boolean;
  onIncludeChange: (include: boolean) => void;
  id?: string;
}) {
  const trimmed = globalEmailFooterTrimmed(footer);

  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/20 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Checkbox
          id={id}
          checked={includeFooter}
          onCheckedChange={(v) => onIncludeChange(v === true)}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={id} className="text-xs font-medium cursor-pointer">
            Append email footer
          </Label>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Shared across all mailboxes (Settings → Email). Added after the signature when this
            email is queued. Uncheck to skip for this send.
          </p>
        </div>
      </div>
      {includeFooter ? (
        trimmed ? (
          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded border bg-background/80 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
            {trimmed}
          </pre>
        ) : (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            No footer set yet. Add one in Settings → Email, or leave this off.
          </p>
        )
      ) : null}
    </div>
  );
}
