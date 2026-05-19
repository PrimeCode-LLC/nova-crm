import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  deleteMailboxForMemberServer,
  getEmailAccountMetaServer,
  listMailboxesForMemberServer,
  upsertMailboxWithSecretsMerged,
} from "@/lib/email/mailbox-profiles-server";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";

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

  const { organizationId } = g.ctx.session;
  const { dataOwnerUid, viewerIsMailboxOwner } = resolved;
  const [mailboxes, meta] = await Promise.all([
    listMailboxesForMemberServer({ organizationId, uid: dataOwnerUid }),
    getEmailAccountMetaServer({ organizationId, uid: dataOwnerUid }),
  ]);

  return NextResponse.json({
    ok: true,
    dataOwnerUid,
    mailboxReadOnly: !viewerIsMailboxOwner,
    mailboxes,
    activeMailboxId: meta.activeMailboxId,
    linkedLeadByMessageId: meta.linkedLeadByMessageId,
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
  const result = await upsertMailboxWithSecretsMerged({
    organizationId,
    uid,
    mailbox: parsed.data.mailbox,
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
