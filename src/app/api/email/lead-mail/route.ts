import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { extractEmailAddresses } from "@/lib/email/reply-compose";
import { leadMailProviderKey } from "@/lib/email/lead-mail-ids";
import {
  listLeadMailMessagesServer,
  upsertLeadMailMessagesServer,
} from "@/lib/email/lead-mail-store-server";
import { classifyInboundLeadMailServer } from "@/lib/email/classify-inbound-reply-server";
import { LEAD_MAIL_LIST_LIMIT, type LeadMailUpsertInput } from "@/lib/email/lead-mail-types";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

async function assertLeadInOrg(organizationId: string, leadId: string) {
  const db = getAdminDb();
  if (!db) return { ok: false as const, status: 503, error: "Database not configured." };
  const snap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
  if (!snap.exists) return { ok: false as const, status: 404, error: "Lead not found." };
  const data = snap.data() as Record<string, unknown>;
  if (String(data.organizationId ?? "") !== organizationId) {
    return { ok: false as const, status: 404, error: "Lead not found." };
  }
  const contactEmails = new Set<string>();
  const addEmail = (value: unknown) => {
    const email = String(value ?? "")
      .trim()
      .toLowerCase();
    if (email.includes("@")) contactEmails.add(email);
  };
  addEmail(data.contactEmail);
  const contactId = String(data.contactId ?? "").trim();
  if (contactId) {
    try {
      const contactSnap = await db.collection(COLLECTIONS.contacts).doc(contactId).get();
      if (contactSnap.exists) {
        const contact = contactSnap.data() as Record<string, unknown>;
        addEmail(contact.email);
        addEmail(contact.personalEmail);
      }
    } catch {
      /* lead contactEmail alone is still enough for many leads */
    }
  }
  return {
    ok: true as const,
    contactEmails: [...contactEmails],
  };
}

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const leadId = new URL(req.url).searchParams.get("leadId")?.trim() ?? "";
  if (!leadId) {
    return NextResponse.json({ ok: false, error: "leadId is required" }, { status: 400 });
  }

  const lead = await assertLeadInOrg(g.ctx.session.organizationId, leadId);
  if (!lead.ok) {
    return NextResponse.json({ ok: false, error: lead.error }, { status: lead.status });
  }

  const messages = await listLeadMailMessagesServer({
    organizationId: g.ctx.session.organizationId,
    leadId,
    limit: LEAD_MAIL_LIST_LIMIT,
  });

  return NextResponse.json({ ok: true, messages });
}

const upsertMessageSchema = z.object({
  mailboxId: z.string().min(1).max(120),
  mailboxOwnerUid: z.string().max(128).optional(),
  direction: z.enum(["inbound", "outbound"]),
  id: z.string().min(1).max(300),
  uid: z.number().finite().optional(),
  subject: z.string().max(2000).default(""),
  from: z.string().max(2000).default(""),
  to: z.string().max(4000).default(""),
  cc: z.string().max(4000).optional(),
  replyTo: z.string().max(2000).optional(),
  date: z.string().min(1).max(64),
  seen: z.boolean().optional(),
  preview: z.string().max(2000).optional(),
  bodyText: z.string().max(100_000).optional(),
  bodyHtml: z.string().max(200_000).optional(),
  bodySynced: z.boolean().optional(),
  messageId: z.string().max(500).optional(),
  inReplyTo: z.string().max(500).optional(),
  referenceIds: z.array(z.string().max(500)).max(50).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(300),
        mimeType: z.string().max(200).optional(),
        sizeBytes: z.number().finite().nonnegative().optional(),
        contentBase64: z.string().max(400_000).optional(),
        isCalendarInvite: z.boolean().optional(),
      }),
    )
    .max(5)
    .optional(),
});

const postSchema = z.object({
  leadId: z.string().min(1).max(120),
  messages: z.array(upsertMessageSchema).min(1).max(80),
});

/**
 * Client backfill: after IMAP refresh on the Emails tab, persist matched rows
 * so later visits do not wait on the mailbox.
 */
export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const lead = await assertLeadInOrg(g.ctx.session.organizationId, parsed.data.leadId);
  if (!lead.ok) {
    return NextResponse.json({ ok: false, error: lead.error }, { status: lead.status });
  }

  const contactSet = new Set(lead.contactEmails);
  const upserts: LeadMailUpsertInput[] = [];

  for (const msg of parsed.data.messages) {
    if (contactSet.size > 0) {
      const addresses = extractEmailAddresses(msg.from, msg.to, msg.cc);
      if (![...addresses].some((address) => contactSet.has(address))) continue;
    }
    const localId =
      msg.direction === "outbound"
        ? normalizeMessageId(msg.messageId) || msg.id
        : msg.id;
    upserts.push({
      mailboxId: msg.mailboxId,
      mailboxOwnerUid: msg.mailboxOwnerUid || g.ctx.session.uid,
      direction: msg.direction,
      providerKey: leadMailProviderKey({
        mailboxId: msg.mailboxId,
        direction: msg.direction,
        localId,
      }),
      uid: msg.uid,
      subject: msg.subject,
      from: msg.from,
      to: msg.to,
      cc: msg.cc,
      replyTo: msg.replyTo,
      date: msg.date,
      seen: msg.seen,
      preview: msg.preview,
      bodyText: msg.bodyText,
      bodyHtml: msg.bodyHtml,
      bodySynced: msg.bodySynced,
      messageId: normalizeMessageId(msg.messageId),
      inReplyTo: normalizeMessageId(msg.inReplyTo),
      referenceIds: msg.referenceIds
        ?.map((id) => normalizeMessageId(id))
        .filter((id): id is string => Boolean(id)),
      attachments: msg.attachments?.map((att) => ({
        filename: att.filename,
        mimeType: att.mimeType || "application/octet-stream",
        sizeBytes: att.sizeBytes ?? 0,
        ...(att.contentBase64 ? { contentBase64: att.contentBase64 } : {}),
        ...(att.isCalendarInvite ? { isCalendarInvite: true } : {}),
      })),
      source: "client_sync",
    });
  }

  if (upserts.length === 0) {
    return NextResponse.json({ ok: true, written: 0 });
  }

  const { written } = await upsertLeadMailMessagesServer({
    organizationId: g.ctx.session.organizationId,
    leadId: parsed.data.leadId,
    mailboxOwnerUid: g.ctx.session.uid,
    messages: upserts,
  });

  if (written > 0) {
    try {
      await classifyInboundLeadMailServer({
        organizationId: g.ctx.session.organizationId,
        leadId: parsed.data.leadId,
        messages: upserts,
        actorUid: g.ctx.session.uid,
      });
    } catch {
      /* persist succeeded */
    }
  }

  return NextResponse.json({ ok: true, written });
}
