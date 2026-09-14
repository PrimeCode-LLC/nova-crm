/**
 * Reverse-funnel projection: leads / emails / mailboxes needed for a target.
 */

export type ProjectionRates = {
  deliveredRate: number;
  positiveReplyRate: number;
  positiveToMeetingRate: number;
  meetingToDealRate: number;
  sendsPerMailboxPerDay: number;
  stepsPerLead: number;
};

export const DEFAULT_PROJECTION_RATES: ProjectionRates = {
  deliveredRate: 0.97,
  positiveReplyRate: 0.02,
  positiveToMeetingRate: 0.5,
  meetingToDealRate: 0.22,
  sendsPerMailboxPerDay: 40,
  stepsPerLead: 4,
};

export type ProjectionInput = {
  targetDeals?: number;
  targetMeetings?: number;
  rates?: Partial<ProjectionRates>;
  horizonDays?: number;
};

export type ProjectionResult = {
  rates: ProjectionRates;
  requiredMeetings: number;
  requiredPositiveReplies: number;
  requiredDelivered: number;
  requiredLeads: number;
  requiredEmails: number;
  mailboxDays: number;
  mailboxesForHorizon: number;
  horizonDays: number;
};

export function projectOutreachFunnel(input: ProjectionInput = {}): ProjectionResult {
  const rates: ProjectionRates = { ...DEFAULT_PROJECTION_RATES, ...input.rates };
  const horizonDays = input.horizonDays ?? 30;
  const targetDeals = input.targetDeals ?? 1;
  const requiredMeetings =
    input.targetMeetings ??
    Math.ceil(targetDeals / Math.max(0.001, rates.meetingToDealRate));
  const requiredPositiveReplies = Math.ceil(
    requiredMeetings / Math.max(0.001, rates.positiveToMeetingRate),
  );
  const requiredDelivered = Math.ceil(
    requiredPositiveReplies / Math.max(0.001, rates.positiveReplyRate),
  );
  const requiredLeads = Math.ceil(requiredDelivered / Math.max(0.001, rates.deliveredRate));
  const requiredEmails = requiredLeads * rates.stepsPerLead;
  const mailboxDays = Math.ceil(requiredEmails / Math.max(1, rates.sendsPerMailboxPerDay));
  const mailboxesForHorizon = Math.ceil(mailboxDays / Math.max(1, horizonDays));

  return {
    rates,
    requiredMeetings,
    requiredPositiveReplies,
    requiredDelivered,
    requiredLeads,
    requiredEmails,
    mailboxDays,
    mailboxesForHorizon,
    horizonDays,
  };
}
