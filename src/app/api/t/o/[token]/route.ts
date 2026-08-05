import { NextResponse } from "next/server";
import { verifyMailTrackingToken } from "@/lib/email/mail-tracking-token";
import {
  recordMailTrackingOpen,
  TRACKING_PIXEL_GIF,
} from "@/lib/email/mail-tracking-server";

type RouteCtx = { params: Promise<{ token: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw ?? "").trim();
  const payload = verifyMailTrackingToken(token);
  if (!payload || payload.t !== "o") {
    return new NextResponse(TRACKING_PIXEL_GIF, {
      status: 200,
      headers: pixelHeaders(),
    });
  }

  const ua = req.headers.get("user-agent");
  await recordMailTrackingOpen({
    trackingId: payload.id,
    userAgent: ua,
    recipientId: payload.r,
  });

  return new NextResponse(TRACKING_PIXEL_GIF, {
    status: 200,
    headers: pixelHeaders(),
  });
}

function pixelHeaders(): HeadersInit {
  return {
    "Content-Type": "image/gif",
    "Content-Length": String(TRACKING_PIXEL_GIF.length),
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
  };
}
