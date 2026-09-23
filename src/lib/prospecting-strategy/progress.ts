import type { Lead } from "@/lib/types";
import {
  evidencePassesStrengthRule,
  personalizationIsComplete,
  type StrategyDailyTargets,
} from "@/lib/prospecting-strategy/qualify";
import { DEFAULT_DAILY_TARGETS } from "@/lib/prospecting-strategy/qualify";
import { resolveDailyTargets } from "@/lib/prospecting-strategy/types";
import type { ProspectingStrategy } from "@/lib/prospecting-strategy/types";

export type StrategyDayProgress = {
  researched: number;
  /** Counts toward daily completed target (passed qualify gate). */
  completed: number;
  qualified: number;
  rejected: number;
  highIntent: number;
  uniqueCompanies: number;
  verifiedEmails: number;
  withEvidence: number;
  withRecentSignal: number;
  warm: number;
  hot: number;
  deeplyPersonalized: number;
  incomplete: number;
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

function companyKey(lead: Lead): string {
  const domain = lead.companyDomain?.trim().toLowerCase();
  if (domain) return `d:${domain}`;
  return `n:${(lead.companyName || "").trim().toLowerCase()}`;
}

/** Whether a prospect counts as a completed daily unit. */
export function isCompletedProspect(
  lead: Lead,
  outreachThreshold = 45,
): boolean {
  if (lead.prospectQualifyStatus === "rejected") return false;
  if (lead.prospectQualifyStatus === "completed") return true;
  if (lead.prospectQualifyStatus === "incomplete") return false;

  // Legacy rows: infer from structured fields when present
  const hasEvidence = evidencePassesStrengthRule(lead.intentEvidence ?? []);
  const hasPersonalization = personalizationIsComplete(lead.personalizationNote);
  if (hasEvidence && hasPersonalization) {
    if (lead.qualityScore != null && lead.qualityScore < outreachThreshold) return false;
    return true;
  }
  // Pre–1.5 fallback: scored research counted as researched/qualified only
  return false;
}

/**
 * Count today's prospecting progress from leads attributed to a strategy/assignment.
 */
export function countStrategyDayProgress(opts: {
  leads: Lead[];
  userId: string;
  strategyId?: string;
  strategyAssignmentId?: string;
  strategyAssignmentIds?: readonly string[];
  outreachThreshold?: number;
  now?: Date;
  /** Inclusive start of the org-local day. Pair with `dayEnd` so the server TZ is not used. */
  dayStart?: Date;
  /** Exclusive end of the org-local day. */
  dayEnd?: Date;
}): StrategyDayProgress {
  const dayStart = opts.dayStart ?? startOfLocalDay(opts.now ?? new Date());
  const dayEnd = opts.dayEnd;
  const threshold = opts.outreachThreshold ?? 45;
  let researched = 0;
  let completed = 0;
  let qualified = 0;
  let rejected = 0;
  let highIntent = 0;
  let verifiedEmails = 0;
  let withEvidence = 0;
  let withRecentSignal = 0;
  let warm = 0;
  let hot = 0;
  let deeplyPersonalized = 0;
  let incomplete = 0;
  const companies = new Set<string>();
  const assignmentIds = opts.strategyAssignmentIds?.length
    ? new Set(opts.strategyAssignmentIds)
    : undefined;

  for (const lead of opts.leads) {
    if (lead.intakeKind !== "prospect") continue;
    if (opts.strategyId && lead.strategyId !== opts.strategyId) continue;
    if (
      opts.strategyAssignmentId &&
      lead.strategyAssignmentId !== opts.strategyAssignmentId
    ) {
      continue;
    }
    if (assignmentIds && (!lead.strategyAssignmentId || !assignmentIds.has(lead.strategyAssignmentId))) {
      continue;
    }
    const actor = lead.scraperId || lead.createdById || lead.prospectOwnerId || lead.ownerId;
    if (actor !== opts.userId) continue;
    if (dayEnd) {
      const created = Date.parse(lead.createdAt ?? "");
      if (!Number.isFinite(created) || created < dayStart.getTime() || created >= dayEnd.getTime()) {
        continue;
      }
    } else if (!isSameLocalDay(lead.createdAt, dayStart)) {
      continue;
    }

    researched += 1;

    if (lead.prospectQualifyStatus === "rejected" || lead.doNotContact || lead.stage === "lost") {
      rejected += 1;
      continue;
    }

    if (lead.prospectQualifyStatus === "incomplete") {
      incomplete += 1;
    }

    const done = isCompletedProspect(lead, threshold);
    if (done) {
      completed += 1;
      companies.add(companyKey(lead));
      if (lead.intentEvidence?.length) {
        withEvidence += 1;
        if (evidencePassesStrengthRule(lead.intentEvidence)) withRecentSignal += 1;
      }
      if (lead.deeplyPersonalized) deeplyPersonalized += 1;
      if (lead.temperature === "warm") warm += 1;
      if (lead.temperature === "hot") hot += 1;
      if (lead.emailVerified) verifiedEmails += 1;
    }

    const score = lead.qualityScore ?? 0;
    if (
      done ||
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

  return {
    researched,
    completed,
    qualified,
    rejected,
    highIntent,
    uniqueCompanies: companies.size,
    verifiedEmails,
    withEvidence,
    withRecentSignal,
    warm,
    hot,
    deeplyPersonalized,
    incomplete,
  };
}

export function countUserDayProgress(
  leads: Lead[],
  userId: string,
  outreachThreshold?: number,
  now?: Date,
  strategyAssignmentIds?: readonly string[],
): StrategyDayProgress {
  return countStrategyDayProgress({
    leads,
    userId,
    outreachThreshold,
    now,
    strategyAssignmentIds,
  });
}

export function progressAgainstTargets(
  progress: StrategyDayProgress,
  targets: StrategyDailyTargets = DEFAULT_DAILY_TARGETS,
): { key: keyof StrategyDailyTargets; label: string; current: number; target: number }[] {
  return [
    { key: "completed", label: "Completed", current: progress.completed, target: targets.completed },
    {
      key: "uniqueCompanies",
      label: "Unique companies",
      current: progress.uniqueCompanies,
      target: targets.uniqueCompanies,
    },
    {
      key: "verifiedEmails",
      label: "Verified emails",
      current: progress.verifiedEmails,
      target: targets.verifiedEmails,
    },
    {
      key: "withEvidence",
      label: "With evidence URL",
      current: progress.withEvidence,
      target: targets.withEvidence,
    },
    {
      key: "withRecentSignal",
      label: "Recent intent signal",
      current: progress.withRecentSignal,
      target: targets.withRecentSignal,
    },
    { key: "warm", label: "Warm", current: progress.warm, target: targets.warm },
    { key: "hot", label: "Hot", current: progress.hot, target: targets.hot },
    {
      key: "deeplyPersonalized",
      label: "Deeply personalized",
      current: progress.deeplyPersonalized,
      target: targets.deeplyPersonalized,
    },
  ];
}

export function targetsForStrategy(strategy: ProspectingStrategy | undefined): StrategyDailyTargets {
  return resolveDailyTargets(strategy);
}

/** Count existing prospect contacts for a company by domain/name for a researcher. */
export function countCompanyContactsForUser(
  leads: Lead[],
  userId: string,
  companyDomain?: string,
  companyName?: string,
): number {
  const domain = companyDomain?.trim().toLowerCase();
  const name = companyName?.trim().toLowerCase();
  if (!domain && !name) return 0;
  let n = 0;
  for (const lead of leads) {
    if (lead.intakeKind !== "prospect") continue;
    if (lead.prospectQualifyStatus === "rejected") continue;
    const actor = lead.scraperId || lead.createdById || lead.prospectOwnerId || lead.ownerId;
    if (actor !== userId) continue;
    const ld = lead.companyDomain?.trim().toLowerCase();
    const ln = lead.companyName?.trim().toLowerCase();
    if (domain && ld && ld === domain) n += 1;
    else if (!domain && name && ln === name) n += 1;
  }
  return n;
}
