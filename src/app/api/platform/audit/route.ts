import { NextResponse } from "next/server";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import { listPlatformAuditServer } from "@/lib/platform/platform-audit-server";

export async function GET(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500) : 100;

  const entries = await listPlatformAuditServer(limit);
  return NextResponse.json({ entries });
}
