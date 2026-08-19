import { NextResponse } from "next/server";

/** Dual-write CRM mirror removed (P7). Use POST /api/org/crm-write. */
export async function POST() {
  return NextResponse.json(
    { error: "CRM mirror endpoint removed. Use POST /api/org/crm-write." },
    { status: 410 },
  );
}
