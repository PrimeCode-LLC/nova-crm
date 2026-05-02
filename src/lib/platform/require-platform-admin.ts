import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";

/** Use in `(platform)` layouts and server pages. */
export async function requirePlatformAdminSession() {
  const session = await requireSession();
  if (isAuthDisabled()) {
    return session;
  }
  const ok = await isUserPlatformAdmin(session.uid, session.email);
  if (!ok) {
    redirect("/dashboard");
  }
  return session;
}
