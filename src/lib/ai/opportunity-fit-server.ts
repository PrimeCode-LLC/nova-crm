import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import type {
  OpportunityFitMessage,
  OpportunityFitResult,
  OpportunityFitScan,
  OpportunitySourceType,
} from "@/lib/ai/opportunity-fit-types";
import type { OrgMemberRole, Role } from "@/lib/types";

const SCAN_LIST_LIMIT = 80;
const MESSAGE_LIMIT = 100;

function scansCol(organizationId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.opportunityScans);
}

export function viewerIsElevatedForFitScans(input: {
  orgRole: OrgMemberRole;
  roleId?: Role;
  isSuperAdmin?: boolean;
}): boolean {
  if (input.isSuperAdmin) return true;
  if (input.orgRole === "owner" || input.orgRole === "admin") return true;
  if (input.roleId === "director") return true;
  return false;
}

function mapScan(id: string, organizationId: string, data: Record<string, unknown>): OpportunityFitScan {
  return {
    id,
    organizationId,
    createdByUserId: String(data.createdByUserId ?? ""),
    createdByDisplayName: data.createdByDisplayName as string | undefined,
    title: String(data.title ?? "Untitled"),
    sourceType: (data.sourceType ?? "other") as OpportunitySourceType,
    rawInput: String(data.rawInput ?? ""),
    result: data.result as OpportunityFitResult,
    verdict: (data.verdict ?? "maybe") as OpportunityFitResult["verdict"],
    fitScore: Number(data.fitScore ?? 0),
    leadId: data.leadId as string | undefined,
    profileId: data.profileId as string | undefined,
    profileDisplayName: data.profileDisplayName as string | undefined,
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
  };
}

export async function createOpportunityScanServer(input: {
  organizationId: string;
  userId: string;
  userDisplayName?: string;
  title: string;
  sourceType: OpportunitySourceType;
  rawInput: string;
  result: OpportunityFitResult;
  leadId?: string;
  profileId?: string;
  profileDisplayName?: string;
}): Promise<{ ok: true; scan: OpportunityFitScan } | { error: string }> {
  const col = scansCol(input.organizationId);
  if (!col) return { error: "Database not configured" };

  const now = new Date().toISOString();
  const ref = col.doc();
  const payload = {
    organizationId: input.organizationId,
    createdByUserId: input.userId,
    createdByDisplayName: input.userDisplayName ?? null,
    title: input.title.trim() || "Opportunity check",
    sourceType: input.sourceType,
    rawInput: input.rawInput,
    result: input.result,
    verdict: input.result.verdict,
    fitScore: input.result.fitScore,
    leadId: input.leadId ?? null,
    profileId: input.profileId ?? null,
    profileDisplayName: input.profileDisplayName ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(payload);
  return { ok: true, scan: mapScan(ref.id, input.organizationId, payload) };
}

export async function listOpportunityScansServer(input: {
  organizationId: string;
  viewerUserId: string;
  elevated: boolean;
  filterUserId?: string;
  limit?: number;
}): Promise<OpportunityFitScan[]> {
  const col = scansCol(input.organizationId);
  if (!col) return [];

  let q = col.orderBy("createdAt", "desc").limit(input.limit ?? SCAN_LIST_LIMIT);

  if (input.elevated && input.filterUserId) {
    q = col
      .where("createdByUserId", "==", input.filterUserId)
      .orderBy("createdAt", "desc")
      .limit(input.limit ?? SCAN_LIST_LIMIT);
  } else if (!input.elevated) {
    q = col
      .where("createdByUserId", "==", input.viewerUserId)
      .orderBy("createdAt", "desc")
      .limit(input.limit ?? SCAN_LIST_LIMIT);
  }

  const snap = await q.get();
  return snap.docs.map((d) => mapScan(d.id, input.organizationId, d.data()));
}

export async function getOpportunityScanServer(input: {
  organizationId: string;
  scanId: string;
  viewerUserId: string;
  elevated: boolean;
}): Promise<OpportunityFitScan | null> {
  const col = scansCol(input.organizationId);
  if (!col) return null;
  const snap = await col.doc(input.scanId).get();
  if (!snap.exists) return null;
  const scan = mapScan(snap.id, input.organizationId, snap.data()!);
  if (!input.elevated && scan.createdByUserId !== input.viewerUserId) return null;
  return scan;
}

export async function appendOpportunityScanMessageServer(input: {
  organizationId: string;
  scanId: string;
  viewerUserId: string;
  elevated: boolean;
  role: "user" | "assistant";
  content: string;
}): Promise<{ ok: true; message: OpportunityFitMessage } | { error: string }> {
  const scan = await getOpportunityScanServer({
    organizationId: input.organizationId,
    scanId: input.scanId,
    viewerUserId: input.viewerUserId,
    elevated: input.elevated,
  });
  if (!scan) return { error: "Scan not found" };

  const col = scansCol(input.organizationId);
  if (!col) return { error: "Database not configured" };

  const now = new Date().toISOString();
  const ref = col.doc(input.scanId).collection("messages").doc();
  const message: OpportunityFitMessage = {
    id: ref.id,
    role: input.role,
    content: input.content,
    createdAt: now,
  };
  await ref.set(message);
  await col.doc(input.scanId).update({ updatedAt: now });
  return { ok: true, message };
}

export async function listOpportunityScanMessagesServer(input: {
  organizationId: string;
  scanId: string;
  viewerUserId: string;
  elevated: boolean;
}): Promise<OpportunityFitMessage[]> {
  const scan = await getOpportunityScanServer({
    organizationId: input.organizationId,
    scanId: input.scanId,
    viewerUserId: input.viewerUserId,
    elevated: input.elevated,
  });
  if (!scan) return [];

  const col = scansCol(input.organizationId);
  if (!col) return [];

  const snap = await col
    .doc(input.scanId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limit(MESSAGE_LIMIT)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      role: (data.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(data.content ?? ""),
      createdAt: String(data.createdAt ?? ""),
    };
  });
}

export function formatScanForDiscussPrompt(scan: OpportunityFitScan): Record<string, string> {
  const r = scan.result;
  return {
    title: scan.title,
    sourceType: scan.sourceType,
    verdict: r.verdict,
    fitScore: String(r.fitScore),
    fitLabel: r.fitLabel,
    summary: r.summary,
    strongMatches: r.strongMatches.map((m) => `• ${m.point}`).join("\n") || "(none)",
    gaps: r.gaps.map((g) => `• [${g.severity}] ${g.point}`).join("\n") || "(none)",
    hooks: r.hooks
      .map((h, i) => `${i + 1}. ${h.angle}, ${h.painPoint}\n   Opener: ${h.opener}`)
      .join("\n\n"),
    pursueHeadline: r.pursueRecommendation.headline,
    pursueReasoning: r.pursueRecommendation.reasoning,
    opportunityExcerpt: scan.rawInput.slice(0, 4000),
  };
}
