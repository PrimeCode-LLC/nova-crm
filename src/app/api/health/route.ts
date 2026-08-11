import { NextResponse } from "next/server";

/** Container / orchestrator healthcheck (Dockerfile HEALTHCHECK). */
export async function GET() {
  return NextResponse.json({ ok: true, role: "web" });
}
