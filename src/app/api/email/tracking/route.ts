import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { listMailTrackingByMessageIds } from "@/lib/email/mail-tracking-server";

const querySchema = z.object({
  messageIds: z.array(z.string().min(1).max(998)).min(1).max(100),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = querySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid messageIds" }, { status: 400 });
  }

  const byMessageId = await listMailTrackingByMessageIds({
    organizationId: g.ctx.session.organizationId,
    messageIds: parsed.data.messageIds,
  });

  return NextResponse.json({ ok: true, byMessageId });
}
