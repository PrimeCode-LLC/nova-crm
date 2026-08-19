import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";

export async function assertLeadContactAllowedServer(input: {
  organizationId: string;
  leadId: string | undefined;
}): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const leadId = input.leadId?.trim();
  if (!leadId) return { ok: true };

  const db = getAdminDb();
  if (!db) {
    return { ok: false, status: 503, error: "Database not configured." };
  }
  const snapshot = await db.collection(COLLECTIONS.leads).doc(leadId).get();
  if (!snapshot.exists) {
    return { ok: false, status: 404, error: "Lead not found." };
  }
  const data = snapshot.data() as Record<string, unknown>;
  if (String(data.organizationId ?? "") !== input.organizationId) {
    return { ok: false, status: 404, error: "Lead not found." };
  }
  if (data.doNotContact === true) {
    return {
      ok: false,
      status: 409,
      error: "This lead is marked do not contact. Remove that restriction before sending email.",
    };
  }
  return { ok: true };
}
