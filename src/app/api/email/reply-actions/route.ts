import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  decideReplyActionServer,
  getReplyActionServer,
} from "@/lib/email/classify-inbound-reply-server";
import { generateReplyActionDraftServer } from "@/lib/email/generate-reply-action-draft-server";
import {
  saveReplyActionDraftServer,
  sendReplyActionServer,
} from "@/lib/email/send-reply-action-server";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const actionId = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!actionId) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const action = await getReplyActionServer({
    organizationId: g.ctx.session.organizationId,
    actionId,
  });
  if (!action) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, action });
}

const patchSchema = z.object({
  id: z.string().min(1).max(120),
  decision: z.enum(["accepted", "dismissed", "send", "save_draft", "regenerate"]),
  draftBody: z.string().max(50_000).optional(),
  draftSubject: z.string().max(500).optional(),
});

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  if (parsed.data.decision === "regenerate") {
    const result = await generateReplyActionDraftServer({
      organizationId: orgId,
      actionId: parsed.data.id,
      actorUid: uid,
      force: true,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    const action = await getReplyActionServer({ organizationId: orgId, actionId: parsed.data.id });
    return NextResponse.json({ ok: true, action });
  }

  if (parsed.data.decision === "save_draft") {
    if (parsed.data.draftBody == null) {
      return NextResponse.json({ ok: false, error: "draftBody is required" }, { status: 400 });
    }
    const result = await saveReplyActionDraftServer({
      organizationId: orgId,
      actionId: parsed.data.id,
      draftBody: parsed.data.draftBody,
      draftSubject: parsed.data.draftSubject,
      decidedBy: uid,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    const action = await getReplyActionServer({ organizationId: orgId, actionId: parsed.data.id });
    return NextResponse.json({ ok: true, action });
  }

  if (parsed.data.decision === "send") {
    const result = await sendReplyActionServer({
      organizationId: orgId,
      actionId: parsed.data.id,
      decidedBy: uid,
      draftBody: parsed.data.draftBody,
      draftSubject: parsed.data.draftSubject,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, messageId: result.messageId });
  }

  const result = await decideReplyActionServer({
    organizationId: orgId,
    actionId: parsed.data.id,
    decision: parsed.data.decision,
    decidedBy: uid,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
