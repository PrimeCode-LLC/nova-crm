import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";
import { verifyMailTrackingToken } from "@/lib/email/mail-tracking-token";
import { resolveMailTrackingClick } from "@/lib/email/mail-tracking-server";

type RouteCtx = { params: Promise<{ token: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw ?? "").trim();
  const payload = verifyMailTrackingToken(token);
  const fallback = SITE.url;

  if (!payload || payload.t !== "c" || !payload.l) {
    return NextResponse.redirect(fallback, 302);
  }

  const result = await resolveMailTrackingClick({
    trackingId: payload.id,
    linkId: payload.l,
    userAgent: req.headers.get("user-agent"),
  });

  if (!result.ok) {
    return NextResponse.redirect(fallback, 302);
  }

  return NextResponse.redirect(result.url, 302);
}
