import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { AuditLogRecordWithDetail } from "@/lib/firestore/audit-detail";
import { leadDisplayLabel, leadIdFromPath } from "@/lib/leads/lead-display-label";

/** Primary lead id for audit drill-down (meta.leadId only - explicit CRM link). */
export function leadIdFromAuditRow(row: { meta?: Record<string, unknown> }): string | null {
  const id = row.meta?.leadId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function collectLeadIdsFromRow(row: AuditLogRecordWithDetail): string[] {
  const ids = new Set<string>();
  for (const val of [row.updatedValue, row.prevValue]) {
    if (!val) continue;
    const id = leadIdFromPath(val);
    if (id) ids.add(id);
  }
  const path = typeof row.meta.path === "string" ? row.meta.path : null;
  if (path) {
    const id = leadIdFromPath(path);
    if (id) ids.add(id);
  }
  if (typeof row.meta.leadId === "string") ids.add(row.meta.leadId);
  return [...ids];
}

function labelForPath(path: string, labelByLeadId: Map<string, string>): string | null {
  const id = leadIdFromPath(path);
  if (!id) return null;
  return labelByLeadId.get(id) ?? null;
}

/** Replace `/leads/{id}` paths and raw lead ids with contact + company names. */
export async function enrichAuditRowsWithLeadNames<T extends AuditLogRecordWithDetail>(
  rows: T[],
  organizationId: string,
): Promise<T[]> {
  const db = getAdminDb();
  if (!db) return rows;

  const leadIds = [...new Set(rows.flatMap(collectLeadIdsFromRow))];
  if (leadIds.length === 0) return rows;

  const labelByLeadId = new Map<string, string>();
  const snaps = await Promise.all(
    leadIds.map((id) => db.collection(COLLECTIONS.leads).doc(id).get()),
  );
  for (let i = 0; i < leadIds.length; i++) {
    const snap = snaps[i]!;
    if (!snap.exists) continue;
    const data = snap.data();
    if (data?.organizationId !== organizationId) continue;
    labelByLeadId.set(
      leadIds[i]!,
      leadDisplayLabel({
        contactName: data.contactName as string | undefined,
        companyName: data.companyName as string | undefined,
      }),
    );
  }

  if (labelByLeadId.size === 0) return rows;

  return rows.map((row) => {
    let updatedValue = row.updatedValue;
    let prevValue = row.prevValue;
    let message = row.message;

    if (updatedValue) {
      const fromPath = labelForPath(updatedValue, labelByLeadId);
      if (fromPath) updatedValue = fromPath;
      else if (labelByLeadId.has(updatedValue)) updatedValue = labelByLeadId.get(updatedValue)!;
    }

    if (prevValue) {
      const fromPath = labelForPath(prevValue, labelByLeadId);
      if (fromPath) prevValue = fromPath;
      else if (labelByLeadId.has(prevValue)) prevValue = labelByLeadId.get(prevValue)!;
    }

    const path = typeof row.meta.path === "string" ? row.meta.path : null;
    const pathLabel = path ? labelForPath(path, labelByLeadId) : null;
    if (
      pathLabel &&
      (row.event === "feature.page_view" || row.event === "feature.outreach_view")
    ) {
      message = `Visited ${pathLabel}`;
    }

    if (typeof row.meta.leadId === "string" && labelByLeadId.has(row.meta.leadId)) {
      const label = labelByLeadId.get(row.meta.leadId)!;
      if (message?.includes(row.meta.leadId)) {
        message = message.split(row.meta.leadId).join(label);
      }
    }

    return { ...row, updatedValue, prevValue, message } as T;
  });
}
