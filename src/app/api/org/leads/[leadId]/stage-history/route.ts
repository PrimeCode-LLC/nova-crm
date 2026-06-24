import { NextResponse } from "next/server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { listAuditRecordsInRangeServer } from "@/lib/firestore/audit";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { listMembersForDisplayServer } from "@/lib/platform/member-display";
import {
  auditRowToStageEntry,
  auditRowsForLead,
  mergeStageHistoryEntries,
  timelineRowToStageEntry,
  type StageHistoryEntry,
} from "@/lib/audit-stage-history";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";

export async function GET(
  _req: Request,
  context: { params: Promise<{ leadId: string }> },
) {
  const g = await guardAdminFeature("activity_logs");
  if (!g.ok) return g.response;

  const { leadId } = await context.params;
  const trimmedLeadId = leadId?.trim();
  if (!trimmedLeadId) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const db = getAdminDb();

  const [allAuditRows, filterMembers] = await Promise.all([
    listAuditRecordsInRangeServer({ organizationId: orgId }),
    listMembersForDisplayServer(orgId),
  ]);

  const auditRows = auditRowsForLead(allAuditRows, trimmedLeadId);

  const labelByUid = new Map(filterMembers.map((m) => [m.uid, m.label]));

  const entries: StageHistoryEntry[] = [];

  for (const row of auditRows) {
    const actorName = labelByUid.get(row.actorUid) ?? row.actorEmail ?? row.actorUid;
    const entry = auditRowToStageEntry(row, actorName);
    if (entry) entries.push(entry);
  }

  if (db) {
    const timelineSnap = await db
      .collection(COLLECTIONS.timelineEvents)
      .where("leadId", "==", trimmedLeadId)
      .get();

    for (const doc of timelineSnap.docs) {
      const data = doc.data();
      if (data.organizationId !== orgId) continue;
      const actorId = typeof data.actorId === "string" ? data.actorId : null;
      const actorName = actorId ? (labelByUid.get(actorId) ?? null) : null;
      const entry = timelineRowToStageEntry({
        id: doc.id,
        type: String(data.type ?? ""),
        actorId,
        summary: String(data.summary ?? ""),
        createdAt: firestoreValueToIso(data.createdAt) ?? new Date().toISOString(),
        actorName,
      });
      if (entry) entries.push(entry);
    }
  }

  let leadLabel: string | null = null;
  if (db) {
    const leadSnap = await db.collection(COLLECTIONS.leads).doc(trimmedLeadId).get();
    if (leadSnap.exists) {
      const d = leadSnap.data();
      if (d?.organizationId === orgId) {
        const contact = typeof d.contactName === "string" ? d.contactName.trim() : "";
        const company = typeof d.companyName === "string" ? d.companyName.trim() : "";
        leadLabel = contact && company ? `${contact} (${company})` : contact || company || null;
      }
    }
  }

  return NextResponse.json({
    leadId: trimmedLeadId,
    leadLabel,
    history: mergeStageHistoryEntries(entries),
  });
}
