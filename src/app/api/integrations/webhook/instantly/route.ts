import { NextResponse } from "next/server";
import {
  handleInstantlyWebhookEvent,
  verifyInstantlyWebhook,
  type InstantlyWebhookPayload,
} from "@/lib/integrations/instantly/webhook-handler";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organizationId")?.trim();
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId query param required" }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization");
  const headerSecret = req.headers.get("x-webhook-secret");
  const presented =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : headerSecret;

  const verified = await verifyInstantlyWebhook(organizationId, presented);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  let payload: InstantlyWebhookPayload;
  try {
    payload = (await req.json()) as InstantlyWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await handleInstantlyWebhookEvent(organizationId, payload);
    return NextResponse.json({ ok: true, leadId: result.leadId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook handler failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
