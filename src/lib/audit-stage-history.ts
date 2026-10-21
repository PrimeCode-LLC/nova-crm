import type { AuditLogRecord } from "@/lib/documents/audit";
import { leadIdFromAuditRow } from "@/lib/documents/audit-display-enrich";

export type StageHistoryEntry = {
  id: string;
  source: "audit" | "timeline";
  at: string;
  actorUid: string | null;
  actorName: string | null;
  kind: "created" | "stage_changed" | "pushed" | "moved_back";
  prevStage: string | null;
  nextStage: string | null;
  summary: string;
};

export function isAuditStageMilestone(row: AuditLogRecord): boolean {
  if (row.event === "lead.created" || row.event === "lead.stage_changed") return true;
  if (row.fieldName !== "stage") return false;
  const table = row.tableName ?? "";
  return table === "leads" || table === "prospects";
}

export function auditRowToStageEntry(
  row: AuditLogRecord,
  actorName?: string | null,
): StageHistoryEntry | null {
  if (!isAuditStageMilestone(row)) return null;

  const at = row.createdAt ?? "";
  const actorUid = row.actorUid || null;
  const resolvedActor = actorName?.trim() || row.actorEmail?.trim() || actorUid || "Unknown";

  if (row.event === "lead.created") {
    const name =
      typeof row.meta.leadName === "string" && row.meta.leadName.trim()
        ? row.meta.leadName.trim()
        : (row.updatedValue ?? "this lead");
    return {
      id: `audit:${row.id}`,
      source: "audit",
      at,
      actorUid,
      actorName: resolvedActor,
      kind: "created",
      prevStage: null,
      nextStage: null,
      summary: `Created ${name}`,
    };
  }

  const prevStage =
    row.prevValue ??
    (typeof row.meta.prevValue === "string" ? row.meta.prevValue : null) ??
    (typeof row.meta.prevStage === "string" ? row.meta.prevStage : null);
  const nextStage =
    row.updatedValue ??
    (typeof row.meta.updatedValue === "string" ? row.meta.updatedValue : null) ??
    (typeof row.meta.nextStage === "string" ? row.meta.nextStage : null);

  return {
    id: `audit:${row.id}`,
    source: "audit",
    at,
    actorUid,
    actorName: resolvedActor,
    kind: "stage_changed",
    prevStage,
    nextStage,
    summary: `${prevStage ?? "?"} → ${nextStage ?? "?"}`,
  };
}

export function parseTimelineStageSummary(summary: string): {
  prevStage: string | null;
  nextStage: string | null;
} {
  const moved = summary.match(/Moved from (.+?) → (.+)$/i);
  if (moved) {
    return { prevStage: moved[1]!.trim(), nextStage: moved[2]!.trim() };
  }
  const arrow = summary.match(/(.+?) → (.+)$/);
  if (arrow) {
    return { prevStage: arrow[1]!.trim(), nextStage: arrow[2]!.trim() };
  }
  return { prevStage: null, nextStage: null };
}

export function timelineRowToStageEntry(input: {
  id: string;
  type: string;
  actorId?: string | null;
  summary: string;
  createdAt: string;
  actorName?: string | null;
  payload?: Record<string, unknown> | null;
}): StageHistoryEntry | null {
  const actorUid = input.actorId?.trim() || null;
  const base = {
    id: `timeline:${input.id}`,
    source: "timeline" as const,
    at: input.createdAt,
    actorUid,
    actorName: input.actorName?.trim() || actorUid || "Unknown",
  };
  // Prospect ↔ sales-lead moves are milestones too (QA 2.5 / PROS-09).
  if (input.type === "prospect_channel_pushed") {
    return { ...base, kind: "pushed", prevStage: null, nextStage: null, summary: input.summary || "Pushed to sales" };
  }
  if (input.type === "lead_moved_back_to_prospect") {
    const prev = input.payload?.previousStage;
    return {
      ...base,
      kind: "moved_back",
      prevStage: typeof prev === "string" ? prev : null,
      nextStage: "prospect",
      summary: input.summary || "Moved back to prospect",
    };
  }
  if (input.type !== "stage_changed") return null;
  const { prevStage, nextStage } = parseTimelineStageSummary(input.summary);
  return {
    ...base,
    kind: "stage_changed",
    prevStage,
    nextStage,
    summary: prevStage && nextStage ? `${prevStage} → ${nextStage}` : input.summary,
  };
}

function normalizeStage(stage: string | null): string {
  return (stage ?? "").toLowerCase().replace(/[\s_-]+/g, "");
}

/** Window in which an audit row and a timeline row describe the same change. */
const SAME_CHANGE_WINDOW_MS = 2 * 60_000;

/**
 * One stage move is logged twice (audit + timeline) with slightly different
 * timestamps and labels ("negotiation" vs "Negotiation"); show it once,
 * preferring the audit row (QA 2.5 / LEAD-04).
 */
function isSameStageChange(a: StageHistoryEntry, b: StageHistoryEntry): boolean {
  if (a.kind !== "stage_changed" || b.kind !== "stage_changed") return false;
  if (a.source === b.source) return false;
  if ((a.actorUid ?? "") !== (b.actorUid ?? "")) return false;
  if (normalizeStage(a.prevStage) !== normalizeStage(b.prevStage)) return false;
  if (normalizeStage(a.nextStage) !== normalizeStage(b.nextStage)) return false;
  const ta = a.at ? new Date(a.at).getTime() : 0;
  const tb = b.at ? new Date(b.at).getTime() : 0;
  return Math.abs(ta - tb) <= SAME_CHANGE_WINDOW_MS;
}

export function mergeStageHistoryEntries(entries: StageHistoryEntry[]): StageHistoryEntry[] {
  const byKey = new Map<string, StageHistoryEntry>();
  for (const entry of entries) {
    const timeKey = entry.at ? new Date(entry.at).getTime() : 0;
    const key = `${entry.kind}:${entry.summary}:${entry.actorUid ?? ""}:${timeKey}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  // Audit rows first so they win over their timeline twin.
  const ordered = [...byKey.values()].sort((a, b) =>
    a.source === b.source ? 0 : a.source === "audit" ? -1 : 1,
  );
  const kept: StageHistoryEntry[] = [];
  for (const entry of ordered) {
    if (!kept.some((k) => isSameStageChange(k, entry))) kept.push(entry);
  }
  return kept.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return ta - tb;
  });
}

export function auditRowsForLead(rows: AuditLogRecord[], leadId: string): AuditLogRecord[] {
  return rows.filter((row) => leadIdFromAuditRow(row) === leadId);
}
