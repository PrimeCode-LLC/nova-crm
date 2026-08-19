import { NextResponse } from "next/server";

/** Legacy Firebase password reset complete — removed (P7). */
export async function POST() {
  return NextResponse.json(
    { error: "Use Clerk password reset at /forgot-password." },
    { status: 410 },
  );
}
