import type { EmailMailboxSettings, MailInbound, MailSent } from "@/lib/email-account-types";
import { OWNER_SCOPE_PREFIX } from "@/lib/owner-scope";
import type { Lead } from "@/lib/types";
import { extractPrimaryEmailFromMailField } from "@/lib/email/parse-mail-address";
import { extractEmailAddresses } from "@/lib/email/reply-compose";
import { leadContactEmails } from "@/lib/followup-plans";

export type ResponseTimeResolveMode = "prefer-email" | "prefer-stored" | "auto";

export interface LeadEmailResponseContext {
  mailboxes: Pick<EmailMailboxSettings, "emailAddress" | "replyTo">[];
  linkedLeadByMessageId: Record<string, string>;
  inboundByMailbox: Record<string, MailInbound[]>;
  sent: MailSent[];
}

type MailRow = { from: string; to: string; cc?: string };

/** Sales leads and intake prospects (all CRM lead rows). */
export function isLeadOrProspect(lead: Lead): boolean {
  return !lead.intakeKind || lead.intakeKind === "sales_lead" || lead.intakeKind === "prospect";
}

function buildOrgMailboxEmails(
  mailboxes: Pick<EmailMailboxSettings, "emailAddress" | "replyTo">[],
): Set<string> {
  const set = new Set<string>();
  for (const mb of mailboxes) {
    for (const raw of [mb.emailAddress, mb.replyTo]) {
      const e = raw?.trim().toLowerCase();
      if (e && e.includes("@")) set.add(e);
    }
  }
  return set;
}

function rowMatchesLead(
  lead: Lead,
  messageKey: string,
  message: MailRow,
  linked: Record<string, string>,
  extraEmails?: readonly (string | null | undefined)[],
): boolean {
  if (linked[messageKey] === lead.id) return true;
  const contacts = leadContactEmails(lead, ...(extraEmails ?? []));
  if (contacts.length === 0) return false;
  const addrs = extractEmailAddresses(message.from, message.to, message.cc);
  return contacts.some((e) => addrs.has(e));
}

function collectLeadMailEvents(
  lead: Lead,
  ctx: LeadEmailResponseContext,
): { at: string; outbound: boolean }[] {
  const orgEmails = buildOrgMailboxEmails(ctx.mailboxes);
  const events: { at: string; outbound: boolean }[] = [];

  for (const m of ctx.sent) {
    if (!rowMatchesLead(lead, m.id, m, ctx.linkedLeadByMessageId)) continue;
    events.push({ at: m.sentAt, outbound: true });
  }

  for (const [mailboxId, messages] of Object.entries(ctx.inboundByMailbox)) {
    for (const m of messages) {
      const mid = `${mailboxId}:in:${m.id}`;
      if (!rowMatchesLead(lead, mid, m, ctx.linkedLeadByMessageId)) continue;
      const fromEmail = extractPrimaryEmailFromMailField(m.from);
      events.push({ at: m.date, outbound: orgEmails.has(fromEmail) });
    }
  }

  return events;
}

/**
 * Minutes from `lead.createdAt` to the first outbound email to this lead
 * (connected sent row or inbox copy where From is a workspace mailbox).
 * This is “time to first outreach”, not inbound reply latency.
 */
export function computeLeadFirstOutboundResponseMinutes(
  lead: Lead,
  ctx: LeadEmailResponseContext,
): number | null {
  if (!isLeadOrProspect(lead)) return null;

  const anchor = Date.parse(lead.createdAt);
  if (Number.isNaN(anchor)) return null;

  const firstOutbound = collectLeadMailEvents(lead, ctx)
    .filter((e) => e.outbound)
    .map((e) => ({ at: Date.parse(e.at), raw: e.at }))
    .filter((e) => !Number.isNaN(e.at) && e.at >= anchor)
    .sort((a, b) => a.at - b.at)[0];

  if (!firstOutbound) return null;

  const minutes = Math.round((firstOutbound.at - anchor) / 60_000);
  return minutes >= 0 ? minutes : null;
}

/** Prefer live mailbox data; fall back to persisted `responseTimeMinutes`. */
export function resolveLeadResponseTimeMinutes(
  lead: Lead,
  ctx: LeadEmailResponseContext,
  options?: { mode?: ResponseTimeResolveMode; currentUserId?: string },
): number | null {
  if (!isLeadOrProspect(lead)) return null;

  const fromEmail = computeLeadFirstOutboundResponseMinutes(lead, ctx);
  const stored = lead.responseTimeMinutes ?? null;
  const mode = options?.mode ?? "prefer-email";

  if (mode === "auto" && options?.currentUserId) {
    const leadMode: ResponseTimeResolveMode =
      lead.ownerId === options.currentUserId ? "prefer-email" : "prefer-stored";
    return leadMode === "prefer-email" ? (fromEmail ?? stored) : (stored ?? fromEmail);
  }
  if (mode === "prefer-stored") return stored ?? fromEmail;
  return fromEmail ?? stored;
}

/** How to resolve response time for the active dashboard owner filter. */
export function responseTimeModeForOwnerScope(
  ownerScope: string,
  currentUserId: string,
): ResponseTimeResolveMode {
  if (ownerScope === "me") return "prefer-email";
  if (ownerScope === "team") return "prefer-stored";
  if (ownerScope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = ownerScope.slice(OWNER_SCOPE_PREFIX.length);
    return uid === currentUserId ? "prefer-email" : "prefer-stored";
  }
  if (ownerScope === "all-owners") return "auto";
  return "prefer-stored";
}

export function computeAverageResponseTimeMinutes(
  leads: Lead[],
  ctx: LeadEmailResponseContext,
  options?: { ownerScope?: string; currentUserId?: string },
): number | null {
  const mode =
    options?.ownerScope && options.currentUserId
      ? responseTimeModeForOwnerScope(options.ownerScope, options.currentUserId)
      : "prefer-email";

  const values = leads
    .filter(isLeadOrProspect)
    .map((l) =>
      resolveLeadResponseTimeMinutes(l, ctx, {
        mode,
        currentUserId: options?.currentUserId,
      }),
    )
    .filter((v): v is number => v != null);

  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
