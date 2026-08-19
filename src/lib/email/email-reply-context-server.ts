import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  buildFollowupPersonalizationProfile,
  formatFollowupRoleGuidance,
} from "@/lib/ai/followup-personalization";
import { buildLeadSignalProfile, formatLeadSignalGuidance } from "@/lib/ai/lead-signal-profile";
import {
  getLeadMailMessageServer,
  listLeadMailMessagesServer,
} from "@/lib/email/lead-mail-store-server";
import { extractReplyAddress, replySubject } from "@/lib/email/reply-compose";
import { replyTextOnly } from "@/lib/email/strip-quoted-reply";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";

export function leadSnapshotForReply(lead: ReturnType<typeof mapLeadDoc>): string {
  return JSON.stringify(
    {
      id: lead.id,
      stage: lead.stage,
      temperature: lead.temperature,
      companyName: lead.companyName,
      companyIndustry: lead.companyIndustry,
      companySize: lead.companySize,
      contactName: lead.contactName,
      contactTitle: lead.contactTitle,
      contactEmail: lead.contactEmail,
      channel: lead.channel,
      doNotContact: lead.doNotContact,
      notes: lead.notes?.slice(0, 400),
    },
    null,
    2,
  );
}

/**
 * Role/signal guidance for the manual composer (no inbound classifier decision).
 */
export function buildManualComposeReplyGuidance(lead: ReturnType<typeof mapLeadDoc>): string {
  const profile = buildFollowupPersonalizationProfile({ title: lead.contactTitle });
  const signalProfile = buildLeadSignalProfile({ lead });

  const lines = [
    "Manual composer: infer the right next step from the full thread and prospect details.",
    "",
    formatFollowupRoleGuidance(profile),
    formatLeadSignalGuidance(signalProfile),
    `Lead stage: ${lead.stage || "unknown"}`,
    `Temperature: ${lead.temperature || "unknown"}`,
  ];

  if (lead.doNotContact) {
    lines.push(
      "COMPLIANCE: this lead is marked do-not-contact. Acknowledge and close out. Do not pitch and do not ask for a meeting.",
    );
  }

  return lines.filter((line) => line !== undefined).join("\n");
}

/**
 * Load recent lead-mail history for reply drafting (same shape as Reply intelligence).
 */
export async function buildLeadMailThreadForReply(input: {
  organizationId: string;
  leadId: string;
  inboundProviderKey?: string;
  draftInReplyTo?: string;
}): Promise<{
  thread: string;
  subject: string;
  to: string;
  inReplyTo?: string;
  referenceIds?: string[];
  inboundPreview?: string;
  inboundFrom?: string;
  inboundSubject?: string;
  mailboxId?: string;
}> {
  const rows = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: input.leadId,
    limit: 24,
  });
  const chronological = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  let targetInbound =
    (input.inboundProviderKey
      ? await getLeadMailMessageServer({
          organizationId: input.organizationId,
          leadId: input.leadId,
          providerKey: input.inboundProviderKey,
        })
      : null) ||
    chronological
      .slice()
      .reverse()
      .find(
        (r) =>
          r.direction === "inbound" &&
          (!input.draftInReplyTo ||
            normalizeMessageId(r.messageId) === normalizeMessageId(input.draftInReplyTo)),
      ) ||
    chronological.slice().reverse().find((r) => r.direction === "inbound");

  const lines: string[] = [];
  for (const row of chronological.slice(-12)) {
    const who = row.direction === "inbound" ? "THEM" : "US";
    const snippet = replyTextOnly(row.bodyText || row.preview || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
    lines.push(`[${who}] ${row.date} · ${row.subject}\nFrom: ${row.from}\n${snippet}`);
  }

  const to =
    (targetInbound ? extractReplyAddress(targetInbound.replyTo || targetInbound.from) : "") || "";
  const subject = replySubject(targetInbound?.subject);
  const inReplyTo = normalizeMessageId(targetInbound?.messageId) || normalizeMessageId(input.draftInReplyTo);
  const referenceIds = [
    ...(targetInbound?.referenceIds ?? []),
    ...(inReplyTo ? [inReplyTo] : []),
  ]
    .map((id) => normalizeMessageId(id))
    .filter((id): id is string => Boolean(id))
    .slice(-50);

  const inboundPreview = targetInbound
    ? replyTextOnly(targetInbound.bodyText || targetInbound.preview || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280)
    : undefined;

  return {
    thread: lines.length ? lines.join("\n\n") : "(no prior thread stored)",
    subject,
    to,
    inReplyTo,
    referenceIds: referenceIds.length ? referenceIds : undefined,
    inboundPreview: inboundPreview || undefined,
    inboundFrom: targetInbound?.from,
    inboundSubject: targetInbound?.subject,
    mailboxId: targetInbound?.mailboxId,
  };
}

export async function loadLeadForReplyContext(input: {
  organizationId: string;
  leadId: string;
}): Promise<ReturnType<typeof mapLeadDoc> | null> {
  const db = getAdminDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  if (!snap.exists) return null;
  if (String(snap.data()?.organizationId ?? "") !== input.organizationId) return null;
  return mapLeadDoc(snap.id, snap.data() as Record<string, unknown>);
}
