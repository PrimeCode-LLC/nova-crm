import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { setEmailAccountMetaServer } from "@/lib/email/mailbox-profiles-server";

const schema = z.object({
  activeMailboxId: z.string().optional(),
  linkedLeadByMessageId: z.record(z.string(), z.string()).optional(),
  blockedSenderDomains: z.array(z.string()).optional(),
  mailLabels: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        color: z.string(),
      }),
    )
    .optional(),
  labelsByMessageId: z.record(z.string(), z.array(z.string())).optional(),
  flagByMessageId: z.record(z.string(), z.enum(["orange", "red", "purple", "blue", "yellow", "green", "gray"])).optional(),
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

  const { organizationId, uid } = g.ctx.session;
  const result = await setEmailAccountMetaServer({
    organizationId,
    uid,
    meta: parsed.data,
  });
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
