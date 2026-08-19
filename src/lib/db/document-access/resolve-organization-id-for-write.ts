"use client";

import { getClientAuth } from "@/lib/db/document-access/client";

/**
 * Matches `callerOrgId()` in `firestore.rules`: JWT claim first, then user doc.
 * Use this for tenant `organizationId` on client writes so rules accept the document.
 */
export async function resolveOrganizationIdForFirestoreWrite(
  userDocOrganizationId?: string | null,
): Promise<string | null> {
  try {
    const auth = getClientAuth();
    const u = auth.currentUser;
    if (u) {
      const { claims } = await u.getIdTokenResult(false);
      const fromClaim = claims.organizationId;
      if (typeof fromClaim === "string" && fromClaim.trim()) return fromClaim.trim();
    }
  } catch {
    /* ignore */
  }
  const f = userDocOrganizationId?.trim();
  return f && f.length > 0 ? f : null;
}
