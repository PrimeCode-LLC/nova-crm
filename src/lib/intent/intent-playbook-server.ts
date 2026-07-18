import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { defaultIntentPlaybook } from "@/lib/intent/playbook-templates";
import { parseIntentPlaybook, playbookForFirestore } from "@/lib/intent/parse-playbook";
import type { IntentPlaybook } from "@/lib/intent/types";

export async function getOrganizationIntentPlaybookServer(
  organizationId: string,
): Promise<IntentPlaybook> {
  const db = getAdminDb();
  if (!db) return defaultIntentPlaybook();
  const snap = await db.collection(COLLECTIONS.organizations).doc(organizationId).get();
  if (!snap.exists) return defaultIntentPlaybook();
  const raw = snap.data()?.intentPlaybook;
  if (raw == null) return defaultIntentPlaybook();
  return parseIntentPlaybook(raw);
}

export async function updateOrganizationIntentPlaybookServer(
  organizationId: string,
  playbook: IntentPlaybook,
): Promise<{ ok: true; playbook: IntentPlaybook } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.organizations).doc(organizationId);
  const cur = await ref.get();
  if (!cur.exists) return { error: "Organization not found" };

  const normalized = parseIntentPlaybook({
    ...playbook,
    updatedAt: new Date().toISOString(),
  });

  try {
    await ref.update({
      intentPlaybook: playbookForFirestore(normalized),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg || "Failed to save playbook" };
  }

  return { ok: true, playbook: normalized };
}
