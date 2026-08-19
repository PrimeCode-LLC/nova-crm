import { NextResponse } from "next/server";

/** Legacy Firebase session exchange — removed (P7). Use Clerk at /sign-in. */
export async function POST() {
  return NextResponse.json(
    { error: "Firebase session auth removed. Sign in via Clerk at /sign-in." },
    { status: 410 },
  );
}

export async function DELETE() {
  return NextResponse.json({ ok: true });
}
