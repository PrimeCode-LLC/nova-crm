import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { normalizeKeywordList } from "@/lib/intake/keyword-filter";
import {
  EMPTY_INTAKE_FILTER_DEFAULTS,
  parseIntakeFilterDefaults,
} from "@/lib/intake/intake-filter-defaults";
import type { OrganizationIntakeFilterDefaults } from "@/lib/types";

export async function getOrganizationIntakeFilterDefaultsServer(
  organizationId: string,
): Promise<OrganizationIntakeFilterDefaults> {
  const db = getAdminDb();
  if (!db) return { ...EMPTY_INTAKE_FILTER_DEFAULTS };
  const snap = await db.collection(COLLECTIONS.organizations).doc(organizationId).get();
  if (!snap.exists) return { ...EMPTY_INTAKE_FILTER_DEFAULTS };
  return parseIntakeFilterDefaults(snap.data()?.intakeFilterDefaults);
}

export async function updateOrganizationIntakeFilterDefaultsServer(
  organizationId: string,
  defaults: OrganizationIntakeFilterDefaults,
): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.organizations).doc(organizationId);
  const cur = await ref.get();
  if (!cur.exists) return { error: "Organization not found" };

  const normalized: OrganizationIntakeFilterDefaults = {
    includeKeywords: normalizeKeywordList(defaults.includeKeywords),
    excludeKeywords: normalizeKeywordList(defaults.excludeKeywords),
  };

  await ref.update({
    intakeFilterDefaults: normalized,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const { mirrorOrganizationAfterWrite } = await import("@/lib/db/dual-write-orgs");
  await mirrorOrganizationAfterWrite(organizationId);
  return { ok: true };
}
