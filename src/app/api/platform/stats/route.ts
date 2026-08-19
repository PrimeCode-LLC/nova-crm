import { NextResponse } from "next/server";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import { getPlatformStatsServer } from "@/lib/platform/platform-stats-server";

export async function GET() {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const stats = await getPlatformStatsServer();
  return NextResponse.json({ stats });
}
