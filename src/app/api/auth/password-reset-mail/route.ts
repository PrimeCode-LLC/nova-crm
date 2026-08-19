import { NextResponse } from "next/server";

/** Legacy Firebase password reset — removed (P7). Use Clerk. */
export async function POST() {
  return NextResponse.json(
    { error: "Use Clerk forgot-password flow at /forgot-password." },
    { status: 410 },
  );
}
