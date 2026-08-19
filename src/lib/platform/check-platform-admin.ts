import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";

/** Comma-separated emails in env - bootstrap access when `platformAdmins` is empty. */
export function parseBootstrapPlatformAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function isUserPlatformAdmin(
  uid: string,
  email?: string | null,
): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (normalized && parseBootstrapPlatformAdminEmails().has(normalized)) {
    return true;
  }

  const db = getAdminDb();
  if (!db) return false;

  const snap = await db.collection(COLLECTIONS.platformAdmins).doc(uid).get();
  if (!snap.exists) return false;
  const d = snap.data() as { active?: boolean } | undefined;
  return d?.active !== false;
}
