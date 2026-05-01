import { NextResponse } from "next/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { getVerifiedSession } from "@/lib/auth/server";

export async function GET() {
  if (isAuthDisabled()) {
    return NextResponse.json({ user: { uid: "dev", email: "dev@local", name: "Dev user" } });
  }
  const session = await getVerifiedSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: session });
}
