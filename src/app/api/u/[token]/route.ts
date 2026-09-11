import { NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { addSuppression } from "@/lib/email/suppression-server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";

type RouteCtx = { params: Promise<{ token: string }> };

async function applyUnsubscribe(token: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return { ok: false, message: "This unsubscribe link is invalid or expired." };
  }

  await addSuppression({
    organizationId: payload.organizationId,
    email: payload.email,
    reason: "unsubscribe",
    source: "list_unsubscribe",
    leadId: payload.leadId,
  });

  if (payload.leadId) {
    const db = getAdminDb();
    if (db) {
      try {
        await db.collection(COLLECTIONS.leads).doc(payload.leadId).update({
          doNotContact: true,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        /* best-effort */
      }
      try {
        const { cancelLeadOutreachServer } = await import(
          "@/lib/email/cancel-lead-outreach-server"
        );
        await cancelLeadOutreachServer({
          organizationId: payload.organizationId,
          leadId: payload.leadId,
          userId: "system",
          reason: "Recipient unsubscribed",
        });
      } catch {
        /* best-effort */
      }
    }
  }

  return { ok: true, message: "You have been unsubscribed." };
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { token } = await ctx.params;
  const result = await applyUnsubscribe(decodeURIComponent(token));
  const html = `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
    <h1>${result.ok ? "Unsubscribed" : "Unable to unsubscribe"}</h1>
    <p>${result.message}</p>
  </body></html>`;
  return new NextResponse(html, {
    status: result.ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** One-click List-Unsubscribe=One-Click */
export async function POST(_req: Request, ctx: RouteCtx) {
  const { token } = await ctx.params;
  const result = await applyUnsubscribe(decodeURIComponent(token));
  return NextResponse.json(
    { ok: result.ok, message: result.message },
    { status: result.ok ? 200 : 400 },
  );
}
