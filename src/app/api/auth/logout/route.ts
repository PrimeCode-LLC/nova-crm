import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

const LEGACY_SESSION_COOKIE_NAMES = ["__session"] as const;

function clearSessionCookies(res: NextResponse) {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  res.cookies.set(SESSION_COOKIE_NAME, "", base);
  for (const name of LEGACY_SESSION_COOKIE_NAMES) {
    res.cookies.set(name, "", base);
  }
}

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
