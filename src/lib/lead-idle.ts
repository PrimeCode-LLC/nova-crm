import type { Lead } from "./types";

/** Matches demo seed logic: no meaningful activity for this many days → idle (non-terminal stages only). */
export const IDLE_LEAD_THRESHOLD_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export function computeLeadIdleState(
  lead: Lead,
  nowMs: number = Date.now(),
): Pick<Lead, "isIdle" | "idleDays"> {
  const terminal = lead.stage === "won" || lead.stage === "lost";
  const activityIso = lead.lastActivityAt ?? lead.updatedAt ?? lead.createdAt;
  const activityMs = Date.parse(activityIso);
  const idleDays = Number.isNaN(activityMs)
    ? 0
    : Math.max(0, Math.floor((nowMs - activityMs) / MS_PER_DAY));
  if (terminal) {
    return { isIdle: false, idleDays };
  }
  return {
    isIdle: idleDays >= IDLE_LEAD_THRESHOLD_DAYS,
    idleDays,
  };
}

export function enrichLeadIdleState(lead: Lead, nowMs?: number): Lead {
  return { ...lead, ...computeLeadIdleState(lead, nowMs) };
}

export function enrichLeadsIdleState(leads: readonly Lead[], nowMs?: number): Lead[] {
  return leads.map((l) => enrichLeadIdleState(l, nowMs));
}
