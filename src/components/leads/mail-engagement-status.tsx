"use client";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  MailTrackingRecipientEngagement,
  MailTrackingSummary,
} from "@/lib/email/mail-tracking-types";
import { extractEmailAddress } from "@/lib/email/parse-outbound-recipients";
import { fmtRelative } from "@/lib/format";

function engagementByEmail(
  recipients: MailTrackingRecipientEngagement[] | undefined,
): Map<string, MailTrackingRecipientEngagement> {
  const map = new Map<string, MailTrackingRecipientEngagement>();
  for (const row of recipients ?? []) {
    map.set(row.email.toLowerCase(), row);
  }
  return map;
}

function roleLabel(role: MailTrackingRecipientEngagement["role"]): string {
  if (role === "cc") return "Cc";
  if (role === "bcc") return "Bcc";
  return "To";
}

function AddressGroup({
  raw,
  tracking,
}: {
  raw: string;
  tracking?: MailTrackingSummary;
}) {
  const byEmail = engagementByEmail(tracking?.recipients);
  const parts = raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return <>{raw}</>;

  return (
    <>
      {parts.map((part, index) => {
        const email = extractEmailAddress(part);
        const engagement = email ? byEmail.get(email) : undefined;
        return (
          <span key={`${part}-${index}`}>
            {index > 0 ? ", " : null}
            {part}
            {engagement && engagement.openCount > 0 ? (
              <span className="ml-1 whitespace-nowrap text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                opened{engagement.openCount > 1 ? ` ×${engagement.openCount}` : ""}
              </span>
            ) : null}
            {engagement && engagement.clickCount > 0 ? (
              <span className="ml-1 whitespace-nowrap text-[10px] font-medium text-sky-700 dark:text-sky-400">
                clicked{engagement.clickCount > 1 ? ` ×${engagement.clickCount}` : ""}
              </span>
            ) : null}
          </span>
        );
      })}
    </>
  );
}

export function MailAddressLineWithEngagement({
  from,
  to,
  cc,
  bcc,
  tracking,
}: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  tracking?: MailTrackingSummary;
}) {
  return (
    <p className="mt-0.5 break-all text-[11px] text-muted-foreground">
      From {from || "Unknown"} · To <AddressGroup raw={to || "Unknown"} tracking={tracking} />
      {cc ? (
        <>
          {" · Cc "}
          <AddressGroup raw={cc} tracking={tracking} />
        </>
      ) : null}
      {bcc ? (
        <>
          {" · Bcc "}
          <AddressGroup raw={bcc} tracking={tracking} />
        </>
      ) : null}
    </p>
  );
}

function EngagementBadge({
  kind,
  tracking,
}: {
  kind: "open" | "click";
  tracking: MailTrackingSummary;
}) {
  const count = kind === "open" ? tracking.openCount : tracking.clickCount;
  const label = `${kind === "open" ? "Opened" : "Clicked"}${count > 1 ? ` ×${count}` : ""}`;
  const recipients = tracking.recipients ?? [];
  const hasRecipientBreakdown = recipients.length > 0;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex cursor-pointer"
            aria-label={
              kind === "open" ? "Show who opened this email" : "Show who clicked a link"
            }
          />
        }
      >
        <Badge variant="outline" className="text-[10px]">
          {label}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        <PopoverHeader>
          <PopoverTitle>{kind === "open" ? "Who opened" : "Who clicked"}</PopoverTitle>
          <PopoverDescription>
            {hasRecipientBreakdown
              ? "Opens and clicks are attributed to each To / Cc / Bcc address on this send."
              : "This older send used one shared tracker, so we can’t tell which address opened it."}
          </PopoverDescription>
        </PopoverHeader>
        {hasRecipientBreakdown ? (
          <ul className="space-y-1.5">
            {recipients.map((row) => {
              const countForKind = kind === "open" ? row.openCount : row.clickCount;
              const at = kind === "open" ? row.lastOpenedAt : row.lastClickedAt;
              return (
                <li key={row.id} className="text-xs">
                  <p className="break-all font-medium">{row.email}</p>
                  <p className="text-muted-foreground">
                    {roleLabel(row.role)}
                    {countForKind > 0
                      ? ` · ${kind === "open" ? "Opened" : "Clicked"} ×${countForKind}${at ? ` · ${fmtRelative(at)}` : ""}`
                      : ` · Not ${kind === "open" ? "opened" : "clicked"}`}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function MailEngagementBadges({ tracking }: { tracking?: MailTrackingSummary }) {
  if (!tracking?.opened && !tracking?.clicked) return null;
  return (
    <>
      {tracking.opened ? <EngagementBadge kind="open" tracking={tracking} /> : null}
      {tracking.clicked ? <EngagementBadge kind="click" tracking={tracking} /> : null}
    </>
  );
}
