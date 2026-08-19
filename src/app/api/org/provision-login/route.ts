import { NextResponse } from "next/server";

/** Firebase provision-login removed (P7). Users sign up via Clerk. */
export async function POST() {
  return NextResponse.json(
    { error: "Provision login removed. Invite users via /admin/team and Clerk sign-up." },
    { status: 410 },
  );
}
