import type { EmailMailboxSettings, ScheduledEmail } from "@/lib/email-account-types";
import {
  autoFixScheduleDates,
  buildDemoMailboxDayLoads,
  fetchMailboxScheduleLoad,
  scheduleDayKeyFromDate,
  type MailboxDayLoadClient,
  type MailboxScheduleLoadResponse,
} from "@/lib/email/mailbox-schedule-capacity";
import type { OrgEmailSendPolicy } from "@/lib/email/org-send-policy";
import {
  isoFromDatetimeLocalInZone,
  isNaiveDatetimeLocal,
  resolveOrgTimezone,
} from "@/lib/org-timezone";
import { toDatetimeLocalValue } from "@/lib/schedule-followup-email-client";

export type MailboxCapacityState = {
  mailboxId: string;
  limit: number | null;
  byDay: Record<string, MailboxDayLoadClient>;
};

export type AssignableScheduleStep = {
  id: string;
  scheduledAt: string;
  included: boolean;
};

function cloneByDay(
  byDay: Record<string, MailboxDayLoadClient>,
): Record<string, MailboxDayLoadClient> {
  const out: Record<string, MailboxDayLoadClient> = {};
  for (const [key, row] of Object.entries(byDay)) {
    out[key] = { ...row };
  }
  return out;
}

export function cloneMailboxCapacityStates(
  states: readonly MailboxCapacityState[],
): MailboxCapacityState[] {
  return states.map((s) => ({
    mailboxId: s.mailboxId,
    limit: s.limit,
    byDay: cloneByDay(s.byDay),
  }));
}

export function capacityStateFromLoad(
  load: MailboxScheduleLoadResponse,
): MailboxCapacityState {
  return {
    mailboxId: load.mailboxId,
    limit: load.limit,
    byDay: cloneByDay(load.byDay),
  };
}

/** Remaining slots on a UTC day (null = unlimited). */
export function remainingOnDay(
  state: MailboxCapacityState,
  dayKey: string,
): number | null {
  if (state.limit == null) return null;
  const row = state.byDay[dayKey];
  if (row?.remaining != null) return row.remaining;
  return Math.max(0, state.limit - (row?.booked ?? 0));
}

/** Total booked (sent+pending) across the horizon — used for unlimited / tie-break. */
export function totalBooked(state: MailboxCapacityState): number {
  let sum = 0;
  for (const row of Object.values(state.byDay)) {
    sum += row.booked;
  }
  return sum;
}

/**
 * Pick one mailbox for a prospect sequence.
 * Prefers most remaining capacity on the first-email UTC day; ties break by
 * round-robin among equals, then lowest total booked.
 */
export function pickMailboxForProspect(input: {
  states: readonly MailboxCapacityState[];
  preferredDayKey: string;
  roundRobinIndex: number;
}): { state: MailboxCapacityState; index: number } | null {
  const { states, preferredDayKey, roundRobinIndex } = input;
  if (states.length === 0) return null;

  const allUnlimited = states.every((s) => s.limit == null);
  if (allUnlimited) {
    const ranked = states
      .map((state, index) => ({ state, index, booked: totalBooked(state) }))
      .sort((a, b) => a.booked - b.booked || a.index - b.index);
    const minBooked = ranked[0]!.booked;
    const ties = ranked.filter((r) => r.booked === minBooked);
    const pick = ties[roundRobinIndex % ties.length]!;
    return { state: pick.state, index: pick.index };
  }

  const scored = states.map((state, index) => {
    const rem = remainingOnDay(state, preferredDayKey);
    const score = rem == null ? Number.POSITIVE_INFINITY : rem;
    return { state, index, score, booked: totalBooked(state) };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.booked !== b.booked) return a.booked - b.booked;
    return a.index - b.index;
  });

  const bestScore = scored[0]!.score;
  const ties = scored.filter((r) => r.score === bestScore);
  const pick = ties[roundRobinIndex % ties.length]!;
  return { state: pick.state, index: pick.index };
}

/** Decrement remaining / bump booked for placed steps on a mailbox capacity state. */
export function consumeCapacityForSteps(
  state: MailboxCapacityState,
  steps: readonly AssignableScheduleStep[],
  timeZone?: string,
): MailboxCapacityState {
  const zone = resolveOrgTimezone(timeZone);
  const byDay = cloneByDay(state.byDay);
  const limit = state.limit;

  for (const step of steps) {
    if (!step.included || !step.scheduledAt) continue;
    const dayKey = scheduleDayKeyFromDate(step.scheduledAt, zone);
    if (!dayKey) continue;
    const prev = byDay[dayKey] ?? {
      dayKey,
      sent: 0,
      pending: 0,
      booked: 0,
      limit,
      remaining: limit == null ? null : limit,
    };
    const booked = prev.booked + 1;
    const pending = prev.pending + 1;
    byDay[dayKey] = {
      ...prev,
      booked,
      pending,
      remaining: limit == null ? null : Math.max(0, limit - booked),
    };
  }

  return { mailboxId: state.mailboxId, limit, byDay };
}

export type AssignProspectScheduleResult =
  | {
      ok: true;
      mailboxId: string;
      steps: AssignableScheduleStep[];
      nextStates: MailboxCapacityState[];
      nextRoundRobinIndex: number;
      nextOrgRemainingByDay?: Record<string, number>;
    }
  | {
      ok: false;
      error: string;
      unresolvedIds: string[];
      nextStates: MailboxCapacityState[];
      nextRoundRobinIndex: number;
      nextOrgRemainingByDay?: Record<string, number>;
    };

/**
 * Choose a mailbox, auto-fix step dates to fit daily limits, and update
 * in-memory capacity so later prospects see this booking.
 *
 * When `candidateMailboxIds` is set, only those mailboxes are eligible for
 * picking (e.g. owner-shared intersection). Capacity is still tracked across
 * the full `states` array.
 */
export function assignProspectSchedule(input: {
  states: readonly MailboxCapacityState[];
  steps: readonly AssignableScheduleStep[];
  roundRobinIndex: number;
  horizonDays?: number;
  timeZone?: string;
  candidateMailboxIds?: readonly string[];
  /** Prefer this mailbox when it is eligible and has capacity for the steps. */
  preferredMailboxId?: string;
  sendPolicy?: OrgEmailSendPolicy | null;
  orgCeiling?: number | null;
  orgRemainingByDay?: Record<string, number>;
}): AssignProspectScheduleResult {
  const zone = resolveOrgTimezone(input.timeZone);
  const states = cloneMailboxCapacityStates(input.states);
  const included = input.steps.filter((s) => s.included && s.scheduledAt);
  if (included.length === 0) {
    return {
      ok: false,
      error: "No steps to schedule",
      unresolvedIds: [],
      nextStates: states,
      nextRoundRobinIndex: input.roundRobinIndex,
    };
  }

  const candidateSet =
    input.candidateMailboxIds == null
      ? null
      : new Set(input.candidateMailboxIds.filter(Boolean));
  const pickStates =
    candidateSet == null
      ? states
      : states.filter((s) => candidateSet.has(s.mailboxId));

  if (pickStates.length === 0) {
    return {
      ok: false,
      error: "No eligible mailboxes for this prospect",
      unresolvedIds: included.map((s) => s.id),
      nextStates: states,
      nextRoundRobinIndex: input.roundRobinIndex,
    };
  }

  const preferredDayKey = scheduleDayKeyFromDate(included[0]!.scheduledAt, zone);
  const preferredId = input.preferredMailboxId?.trim() || "";
  let picked: { state: MailboxCapacityState; index: number } | null = null;

  if (preferredId) {
    const preferredState = pickStates.find((s) => s.mailboxId === preferredId);
    if (preferredState) {
      const trial = autoFixScheduleDates(
        input.steps.map((s) => ({ ...s })),
        preferredState.byDay,
        preferredState.limit,
        input.horizonDays ?? 60,
        zone,
        {
          sendPolicy: input.sendPolicy,
          orgCeiling: input.orgCeiling,
          orgRemainingByDay: input.orgRemainingByDay,
        },
      );
      if (trial.unresolvedIds.length === 0) {
        const stateIndex = states.findIndex((s) => s.mailboxId === preferredId);
        picked = {
          state: preferredState,
          index: stateIndex >= 0 ? stateIndex : 0,
        };
      }
    }
  }

  if (!picked) {
    picked = pickMailboxForProspect({
      states: pickStates,
      preferredDayKey: preferredDayKey || scheduleDayKeyFromDate(new Date(), zone),
      roundRobinIndex: input.roundRobinIndex,
    });
  }
  if (!picked) {
    return {
      ok: false,
      error: "No mailboxes selected",
      unresolvedIds: included.map((s) => s.id),
      nextStates: states,
      nextRoundRobinIndex: input.roundRobinIndex,
    };
  }

  const fixed = autoFixScheduleDates(
    input.steps.map((s) => ({ ...s })),
    picked.state.byDay,
    picked.state.limit,
    input.horizonDays ?? 60,
    zone,
    {
      sendPolicy: input.sendPolicy,
      orgCeiling: input.orgCeiling,
      orgRemainingByDay: input.orgRemainingByDay,
    },
  );

  if (fixed.unresolvedIds.length > 0) {
    return {
      ok: false,
      error: "Could not fit every step within the capacity horizon",
      unresolvedIds: fixed.unresolvedIds,
      nextStates: states,
      nextRoundRobinIndex: input.roundRobinIndex + 1,
      nextOrgRemainingByDay: input.orgRemainingByDay,
    };
  }

  const pickedId = picked.state.mailboxId;
  const nextStates = states.map((s) =>
    s.mailboxId === pickedId ? consumeCapacityForSteps(s, fixed.steps, zone) : s,
  );

  return {
    ok: true,
    mailboxId: pickedId,
    steps: fixed.steps,
    nextStates,
    nextRoundRobinIndex: input.roundRobinIndex + 1,
    nextOrgRemainingByDay: fixed.orgRemainingByDay ?? input.orgRemainingByDay,
  };
}

export type BulkProspectAssignInput = {
  key: string;
  steps: readonly AssignableScheduleStep[];
  candidateMailboxIds?: readonly string[];
  preferredMailboxId?: string;
};

export type BulkProspectAssignResult =
  | {
      key: string;
      ok: true;
      mailboxId: string;
      steps: AssignableScheduleStep[];
    }
  | {
      key: string;
      ok: false;
      error: string;
      unresolvedIds: string[];
    };

function stepInstantMs(scheduledAt: string, timeZone: string): number {
  const iso = isNaiveDatetimeLocal(scheduledAt)
    ? isoFromDatetimeLocalInZone(scheduledAt, timeZone)
    : scheduledAt;
  return new Date(iso).getTime();
}

function anchorStepsAfterFirst(input: {
  steps: readonly AssignableScheduleStep[];
  placedFirst: AssignableScheduleStep;
  timeZone: string;
}): AssignableScheduleStep[] {
  const zone = resolveOrgTimezone(input.timeZone);
  const included = input.steps.filter((s) => s.included && s.scheduledAt);
  if (included.length === 0) return [];
  const sorted = [...included].sort(
    (a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id),
  );
  const firstDraft = sorted[0]!;
  const firstDraftMs = stepInstantMs(firstDraft.scheduledAt, zone);
  const firstPlacedMs = stepInstantMs(input.placedFirst.scheduledAt, zone);
  if (Number.isNaN(firstDraftMs) || Number.isNaN(firstPlacedMs)) {
    return sorted.slice(1).map((s) => ({ ...s }));
  }
  return sorted.slice(1).map((s) => {
    const draftMs = stepInstantMs(s.scheduledAt, zone);
    if (Number.isNaN(draftMs)) return { ...s };
    const gap = Math.max(60_000, draftMs - firstDraftMs);
    return {
      ...s,
      scheduledAt: toDatetimeLocalValue(new Date(firstPlacedMs + gap), zone),
      included: true,
    };
  });
}

/**
 * Assign many prospects with first-email priority:
 * 1) place every sequence's first email (fills earliest capacity first)
 * 2) place remaining steps on the same mailbox, keeping gaps from the placed first send
 */
export function assignBulkProspectSchedules(input: {
  states: readonly MailboxCapacityState[];
  prospects: readonly BulkProspectAssignInput[];
  horizonDays?: number;
  timeZone?: string;
  sendPolicy?: OrgEmailSendPolicy | null;
  orgCeiling?: number | null;
  orgRemainingByDay?: Record<string, number>;
}): {
  results: BulkProspectAssignResult[];
  nextStates: MailboxCapacityState[];
  nextOrgRemainingByDay?: Record<string, number>;
} {
  const zone = resolveOrgTimezone(input.timeZone);
  let states = cloneMailboxCapacityStates(input.states);
  let orgRemainingByDay = input.orgRemainingByDay;
  let rr = 0;

  const firstPlaced = new Map<
    string,
    { mailboxId: string; step: AssignableScheduleStep; allSteps: AssignableScheduleStep[] }
  >();
  const failed = new Map<string, BulkProspectAssignResult & { ok: false }>();

  for (const prospect of input.prospects) {
    const included = prospect.steps.filter((s) => s.included && s.scheduledAt);
    if (included.length === 0) {
      failed.set(prospect.key, {
        key: prospect.key,
        ok: false,
        error: "No steps to schedule",
        unresolvedIds: [],
      });
      continue;
    }
    const sorted = [...included].sort(
      (a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id),
    );
    const first = { ...sorted[0]!, included: true };
    const assigned = assignProspectSchedule({
      states,
      steps: [first],
      roundRobinIndex: rr,
      horizonDays: input.horizonDays,
      timeZone: zone,
      candidateMailboxIds: prospect.candidateMailboxIds,
      preferredMailboxId: prospect.preferredMailboxId,
      sendPolicy: input.sendPolicy,
      orgCeiling: input.orgCeiling,
      orgRemainingByDay,
    });
    rr = assigned.nextRoundRobinIndex;
    states = assigned.nextStates;
    if (assigned.nextOrgRemainingByDay) orgRemainingByDay = assigned.nextOrgRemainingByDay;
    if (!assigned.ok) {
      failed.set(prospect.key, {
        key: prospect.key,
        ok: false,
        error: assigned.error,
        unresolvedIds: assigned.unresolvedIds,
      });
      continue;
    }
    const placed = assigned.steps.find((s) => s.included && s.id === first.id) ?? assigned.steps[0]!;
    firstPlaced.set(prospect.key, {
      mailboxId: assigned.mailboxId,
      step: placed,
      allSteps: sorted.map((s) => ({ ...s })),
    });
  }

  const results: BulkProspectAssignResult[] = [];
  for (const prospect of input.prospects) {
    const earlyFail = failed.get(prospect.key);
    if (earlyFail) {
      results.push(earlyFail);
      continue;
    }
    const head = firstPlaced.get(prospect.key);
    if (!head) {
      results.push({
        key: prospect.key,
        ok: false,
        error: "No steps to schedule",
        unresolvedIds: [],
      });
      continue;
    }

    const rest = anchorStepsAfterFirst({
      steps: head.allSteps,
      placedFirst: head.step,
      timeZone: zone,
    });
    if (rest.length === 0) {
      results.push({
        key: prospect.key,
        ok: true,
        mailboxId: head.mailboxId,
        steps: [head.step],
      });
      continue;
    }

    const assignedRest = assignProspectSchedule({
      states,
      steps: rest,
      roundRobinIndex: rr,
      horizonDays: input.horizonDays,
      timeZone: zone,
      candidateMailboxIds: prospect.candidateMailboxIds,
      preferredMailboxId: head.mailboxId,
      sendPolicy: input.sendPolicy,
      orgCeiling: input.orgCeiling,
      orgRemainingByDay,
    });
    rr = assignedRest.nextRoundRobinIndex;
    states = assignedRest.nextStates;
    if (assignedRest.nextOrgRemainingByDay) orgRemainingByDay = assignedRest.nextOrgRemainingByDay;

    if (!assignedRest.ok) {
      results.push({
        key: prospect.key,
        ok: false,
        error: assignedRest.error,
        unresolvedIds: assignedRest.unresolvedIds,
      });
      continue;
    }

    const byId = new Map<string, AssignableScheduleStep>();
    byId.set(head.step.id, head.step);
    for (const step of assignedRest.steps) {
      if (step.included) byId.set(step.id, step);
    }
    results.push({
      key: prospect.key,
      ok: true,
      mailboxId: head.mailboxId,
      steps: head.allSteps.map((s) => byId.get(s.id) ?? { ...s, included: false }),
    });
  }

  return {
    results,
    nextStates: states,
    nextOrgRemainingByDay: orgRemainingByDay,
  };
}

export async function loadMailboxCapacityStates(input: {
  mailboxes: EmailMailboxSettings[];
  isDemo: boolean;
  scheduled: ScheduledEmail[];
  horizonDays?: number;
  timeZone?: string;
}): Promise<
  | { ok: true; states: MailboxCapacityState[] }
  | { ok: false; error: string }
> {
  const zone = resolveOrgTimezone(input.timeZone);
  const states: MailboxCapacityState[] = [];
  for (const mb of input.mailboxes) {
    if (input.isDemo) {
      const demo = buildDemoMailboxDayLoads({
        scheduled: input.scheduled,
        mailboxId: mb.id,
        dailySendLimit: mb.dailySendLimit,
        horizonDays: input.horizonDays,
        timeZone: zone,
      });
      states.push(capacityStateFromLoad(demo));
      continue;
    }
    const result = await fetchMailboxScheduleLoad({
      mailboxId: mb.id,
      dataOwnerUid: mb.dataOwnerUid,
      horizonDays: input.horizonDays,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    states.push(capacityStateFromLoad(result));
  }
  return { ok: true, states };
}
