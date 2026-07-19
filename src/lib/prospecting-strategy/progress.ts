import type { Lead } from "@/lib/types";

export type StrategyDayProgress = {
  researched: number;
  qualified: number;
  rejected: number;
  highIntent: number;
};

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameLocalDay(iso: string | undefined, dayStart: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const d = new Date(t);
  return (
    d.getFullYear() === dayStart.getFullYear() &&
    d.getMonth() === dayStart.getMonth() &&
    d.getDate() === dayStart.getDate()
  );
}

/**
 * Count today's prospecting progress from leads attributed to a strategy/assignment.
 * A prospect counts once (by lead id). Qualified ≈ score meets threshold or stage past new.
 */
export function countStrategyDayProgress(opts: {
  leads: Lead[];
  userId: string;
  strategyId?: string;
  outreachThreshold?: number;
  now?: Date;
}): StrategyDayProgress {
  const dayStart = startOfLocalDay(opts.now ?? new Date());
  const threshold = opts.outreachThreshold ?? 45;
  let researched = 0;
  let qualified = 0;
  let rejected = 0;
  let highIntent = 0;

  for (const lead of opts.leads) {
    if (lead.intakeKind !== "prospect") continue;
    if (opts.strategyId && lead.strategyId !== opts.strategyId) continue;
    const actor = lead.scraperId || lead.createdById || lead.prospectOwnerId || lead.ownerId;
    if (actor !== opts.userId) continue;
    if (!isSameLocalDay(lead.createdAt, dayStart)) continue;

    researched += 1;
    if (lead.doNotContact || lead.stage === "lost") {
      rejected += 1;
      continue;
    }
    const score = lead.qualityScore ?? 0;
    if (
      score >= threshold ||
      lead.stage === "qualified" ||
      lead.stage === "discovery" ||
      lead.stage === "proposal" ||
      lead.stage === "negotiation" ||
      lead.stage === "won"
    ) {
      qualified += 1;
    }
    if (lead.temperature === "hot" || score >= 70) {
      highIntent += 1;
    }
  }

  return { researched, qualified, rejected, highIntent };
}

export function countUserDayProgress(
  leads: Lead[],
  userId: string,
  outreachThreshold?: number,
  now?: Date,
): StrategyDayProgress {
  return countStrategyDayProgress({ leads, userId, outreachThreshold, now });
}
