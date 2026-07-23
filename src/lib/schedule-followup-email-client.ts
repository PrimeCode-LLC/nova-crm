import type { EmailMailboxSettings } from "@/lib/email-account-types";
import {
  appendGlobalEmailFooter,
  appendMailboxSignature,
} from "@/lib/email/append-mailbox-signature";
import { normalizeRecipientList } from "@/lib/email/parse-outbound-recipients";
import { isEmailAccountConfigured } from "@/stores/email-account-store";

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ScheduleFollowupEmailInput = {
  followupId: string;
  leadId: string;
  mailbox: EmailMailboxSettings;
  to: string;
  subject: string;
  /** Message body without signature/footer; trailers appended when flags are true. */
  body: string;
  /** Default true - append mailbox.signature at queue time. */
  includeSignature?: boolean;
  /**
   * Account-wide footer text (Settings → Email). Applied when includeFooter is true.
   */
  globalEmailFooter?: string;
  /** Default true - append globalEmailFooter after the signature. */
  includeFooter?: boolean;
  scheduledAtIso: string;
  isDemo: boolean;
  addDemoScheduled: (row: {
    mailboxId: string;
    from: string;
    displayName?: string;
    replyTo?: string;
    to: string;
    subject: string;
    body: string;
    text: string;
    scheduledAt: string;
    followupId: string;
    leadId: string;
  }) => string;
};

export type ScheduleFollowupEmailResult =
  | { ok: true; scheduledEmailId: string; emailScheduledAt: string }
  | { ok: false; error: string };

export async function scheduleFollowupEmailClient(
  input: ScheduleFollowupEmailInput,
): Promise<ScheduleFollowupEmailResult> {
  const toParsed = normalizeRecipientList(input.to, "To");
  if (!toParsed.ok) return { ok: false, error: toParsed.error };
  const subjectTrimmed = input.subject.trim();
  if (!subjectTrimmed) return { ok: false, error: "Subject is required" };
  if (!input.body.trim()) return { ok: false, error: "Email body is required" };

  const scheduledDate = new Date(input.scheduledAtIso);
  if (Number.isNaN(scheduledDate.getTime())) {
    return { ok: false, error: "Invalid schedule time" };
  }
  if (scheduledDate.getTime() < Date.now() + 60_000) {
    return { ok: false, error: "Schedule time must be at least 1 minute in the future" };
  }

  const toLine = toParsed.addresses.join(", ");
  const emailScheduledAt = scheduledDate.toISOString();
  const account = input.mailbox;
  const includeSignature = input.includeSignature !== false;
  const includeFooter = input.includeFooter !== false;
  let outboundBody = includeSignature
    ? appendMailboxSignature(input.body, account.signature)
    : input.body.replace(/\s+$/u, "");
  if (includeFooter) {
    outboundBody = appendGlobalEmailFooter(outboundBody, input.globalEmailFooter);
  }

  if (input.isDemo) {
    const id = input.addDemoScheduled({
      mailboxId: account.id,
      from: account.emailAddress.trim() || "demo@nova.local",
      displayName: account.displayName || undefined,
      replyTo: account.replyTo || undefined,
      to: toLine,
      subject: subjectTrimmed,
      body: outboundBody,
      text: outboundBody,
      scheduledAt: emailScheduledAt,
      followupId: input.followupId,
      leadId: input.leadId,
    });
    return { ok: true, scheduledEmailId: id, emailScheduledAt };
  }

  if (!isEmailAccountConfigured(account)) {
    return { ok: false, error: "Configure SMTP in Settings → Email first." };
  }

  const text = outboundBody;
  const html = outboundBody.split("\n").map((l) => `<p>${escapeHtml(l) || "<br/>"}</p>`).join("");
  const owner = account.dataOwnerUid?.trim();
  const scheduleUrl = owner
    ? `/api/email/scheduled?forUser=${encodeURIComponent(owner)}`
    : "/api/email/scheduled";
  try {
    const res = await fetch(scheduleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mailboxId: account.id,
        from: account.emailAddress,
        displayName: account.displayName,
        replyTo: account.replyTo,
        to: toLine,
        subject: subjectTrimmed,
        text,
        html,
        scheduledAt: emailScheduledAt,
        followupId: input.followupId,
        leadId: input.leadId,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      id?: string;
      dayKey?: string;
      used?: number;
      limit?: number;
    };
    if (!data.ok || !data.id) {
      return { ok: false, error: data.error ?? "Could not schedule email" };
    }
    return { ok: true, scheduledEmailId: data.id, emailScheduledAt };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}

export function toDatetimeLocalValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function defaultScheduleDatetimeLocal(preferIso?: string): string {
  const min = new Date(Date.now() + 60_000);
  if (preferIso) {
    const preferred = new Date(preferIso);
    if (!Number.isNaN(preferred.getTime()) && preferred.getTime() >= min.getTime()) {
      return toDatetimeLocalValue(preferred);
    }
  }
  const inOneHour = new Date(Date.now() + 60 * 60_000);
  return toDatetimeLocalValue(inOneHour);
}
