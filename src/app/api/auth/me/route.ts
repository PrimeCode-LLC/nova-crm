import { NextResponse } from "next/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { getVerifiedSession } from "@/lib/auth/server";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";

export async function GET() {
  if (isAuthDisabled()) {
    return NextResponse.json({
      user: { uid: "dev", email: "dev@local", name: "Dev user" },
      isPlatformAdmin: true,
    });
  }
  const session = await getVerifiedSession();
  if (!session) {
    return NextResponse.json({ user: null, isPlatformAdmin: false }, { status: 401 });
  }
  const isPlatformAdmin = await isUserPlatformAdmin(session.uid, session.email);
  return NextResponse.json({ user: session, isPlatformAdmin });
}
