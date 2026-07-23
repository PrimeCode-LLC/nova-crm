import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  deleteMailboxForMemberServer,
  getEmailAccountMetaServer,
  listMailboxesAssignedToViewerServer,
  listMailboxesForMemberServer,
  upsertMailboxWithSecretsMerged,
} from "@/lib/email/mailbox-profiles-server";
import { resolveMailboxDataOwnerUid, mailboxReadOnlyForClient } from "@/lib/email/mailbox-data-owner-server";
import { getMailboxSendCountForDayServer, utcSendDayKey } from "@/lib/email/mailbox-send-quota-server";
import { normalizeCrmEmailKey } from "@/lib/crm-dedup-keys";

const mailboxSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  enabled: z.boolean(),
  displayName: z.string(),
  emailAddress: z.string(),
  replyTo: z.string(),
  smtp: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    user: z.string(),
    password: z.string(),
  }),
  imap: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    user: z.string(),
    password: z.string(),
  }),
  signature: z.string(),
  syncIntervalMinutes: z.number(),
  archiveOnSend: z.boolean(),
  readReceipts: z.boolean(),
  connectionType: z.enum(["google_workspace", "microsoft_outlook", "custom"]).optional().default("custom"),
  dailySendLimit: z.number().int().positive().nullable().optional().default(null),
  assignedUserIds: z.array(z.string()).optional().default([]),
  dataOwnerUid: z.string().optional(),
});

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const forUser = new URL(req.url).searchParams.get("forUser");
  const resolved = await resolveMailboxDataOwnerUid({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    viewerRole: g.ctx.role,
    forUserParam: forUser,
  });
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }

  const { organizationId, uid: viewerUid } = g.ctx.session;
  const { dataOwnerUid } = resolved;
  const [ownMailboxes, meta] = await Promise.all([
    listMailboxesForMemberServer({ organizationId, uid: dataOwnerUid }),
    getEmailAccountMetaServer({ organizationId, uid: dataOwnerUid }),
  ]);

  let mailboxes = ownMailboxes;
  /** Only merge per-mailbox assignments when loading the viewer's own account (not view-as). */
  if (dataOwnerUid === viewerUid && resolved.viewerIsMailboxOwner) {
    const assigned = await listMailboxesAssignedToViewerServer({
      organizationId,
      viewerUid,
    });
    if (assigned.length > 0) {
      const ownIds = new Set(ownMailboxes.map((m) => m.id));
      mailboxes = [...ownMailboxes, ...assigned.filter((m) => !ownIds.has(m.id))];
    }
  }

  const includeUsage = new URL(req.url).searchParams.get("includeUsage") === "1";

  const dayKey = utcSendDayKey();
  const sendUsageByMailboxId: Record<string, { dayKey: string; used: number; limit: number | null }> = {};
  if (includeUsage) {
    await Promise.all(
      mailboxes.map(async (mb) => {
        const ownerUid = mb.dataOwnerUid?.trim() || dataOwnerUid;
        const used = await getMailboxSendCountForDayServer({
          organizationId,
          uid: ownerUid,
          mailboxId: mb.id,
          dayKey,
        });
        sendUsageByMailboxId[mb.id] = {
          dayKey,
          used,
          limit: mb.dailySendLimit,
        };
      }),
    );
  }

  return NextResponse.json({
    ok: true,
    dataOwnerUid,
    mailboxReadOnly: mailboxReadOnlyForClient(resolved),
    mailboxAccountReadOnly: !resolved.viewerIsMailboxOwner,
    mailboxes,
    sendUsageByMailboxId,
    activeMailboxId: meta.activeMailboxId,
    linkedLeadByMessageId: meta.linkedLeadByMessageId,
    blockedSenderDomains: meta.blockedSenderDomains,
    globalEmailFooter: meta.globalEmailFooter,
    mailLabels: meta.mailLabels,
    labelsByMessageId: meta.labelsByMessageId,
    flagByMessageId: meta.flagByMessageId,
  });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = z.object({ mailbox: mailboxSchema }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid mailbox payload" }, { status: 400 });
  }

  const { organizationId, uid } = g.ctx.session;
  const { dataOwnerUid: _ignore, ...mailboxRest } = parsed.data.mailbox;
  const emailKey = normalizeCrmEmailKey(mailboxRest.emailAddress);
  if (emailKey) {
    const existing = await listMailboxesForMemberServer({ organizationId, uid });
    const duplicate = existing.find(
      (m) => m.id !== mailboxRest.id && normalizeCrmEmailKey(m.emailAddress) === emailKey,
    );
    if (duplicate) {
      return NextResponse.json(
        {
          ok: false,
          error: `This email is already added on “${duplicate.label?.trim() || duplicate.emailAddress.trim() || "another mailbox"}”.`,
        },
        { status: 409 },
      );
    }
  }
  const result = await upsertMailboxWithSecretsMerged({
    organizationId,
    uid,
    mailbox: {
      ...mailboxRest,
      connectionType: mailboxRest.connectionType ?? "custom",
      dailySendLimit: mailboxRest.dailySendLimit ?? null,
      assignedUserIds: mailboxRest.assignedUserIds ?? [],
    },
  });
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const mailboxId = url.searchParams.get("mailboxId")?.trim() ?? "";
  if (!mailboxId) {
    return NextResponse.json({ ok: false, error: "mailboxId is required" }, { status: 400 });
  }

  const { organizationId, uid } = g.ctx.session;
  const result = await deleteMailboxForMemberServer({ organizationId, uid, mailboxId });
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
