import type { EmailMailboxSettings, ScheduledEmail } from "@/lib/email-account-types";
import {
  autoFixScheduleDates,
  buildDemoMailboxDayLoads,
  fetchMailboxScheduleLoad,
  scheduleDayKeyFromDate,
  type MailboxDayLoadClient,
  type MailboxScheduleLoadResponse,
} from "@/lib/email/mailbox-schedule-capacity";
import { resolveOrgTimezone } from "@/lib/org-timezone";

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
    }
  | {
      ok: false;
      error: string;
      unresolvedIds: string[];
      nextStates: MailboxCapacityState[];
      nextRoundRobinIndex: number;
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
  );

  if (fixed.unresolvedIds.length > 0) {
    return {
      ok: false,
      error: "Could not fit every step within the capacity horizon",
      unresolvedIds: fixed.unresolvedIds,
      nextStates: states,
      nextRoundRobinIndex: input.roundRobinIndex + 1,
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
