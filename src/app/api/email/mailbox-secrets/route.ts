import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { upsertMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";

const schema = z.object({
  mailboxId: z.string().min(1),
  smtp: z.object({
    user: z.string(),
    password: z.string(),
  }),
  imap: z.object({
    user: z.string(),
    password: z.string(),
  }),
});

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const result = await upsertMailboxSecretsServer({
    organizationId: g.ctx.session.organizationId,
    uid: g.ctx.session.uid,
    mailboxId: parsed.data.mailboxId,
    secrets: parsed.data,
  });
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
