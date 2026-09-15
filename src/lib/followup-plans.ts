import type {
  ChannelKey,
  Followup,
  FollowupChannel,
  FollowupChannelMix,
  FollowupPlan,
  Lead,
} from "@/lib/types";

export function getActiveFollowupPlanForLead(
  plans: readonly FollowupPlan[],
  leadId: string,
): FollowupPlan | undefined {
  return plans
    .filter((p) => p.leadId === leadId && p.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function channelMixLabel(mix: FollowupChannelMix | undefined): string {
  if (mix === "email") return "Email only";
  if (mix === "linkedin") return "LinkedIn only";
  if (mix === "multi_channel") return "Email + LinkedIn";
  if (mix === "lead") return "Lead channel";
  return "Channels";
}

/**
 * LinkedIn caps a connection request note at 300 characters on every plan, so
 * these are platform limits rather than style preferences.
 */
const LINKEDIN_LENGTH_RULES =
  "LinkedIn length is a hard platform limit, not a style preference, and it overrides the role word targets: " +
  "a connection request note must stay under 300 characters (aim 200-280) and must contain no link; " +
  "a message sent after the invite is accepted must stay under 400 characters.";

const LINKEDIN_CHANNEL_SEMANTICS =
  "Channel semantics: linkedin_outbound means the prospect is not a first-degree connection yet, so the first LinkedIn touch is a connection request. " +
  "linkedin_1to1 means context proves they are already a first-degree connection, so you may open with a direct message. " +
  "Default to linkedin_outbound unless context establishes an existing connection.";

const LINKEDIN_ACCEPTANCE_RULE =
  "Any LinkedIn step after a connection request depends on that invite being accepted. Write it as if accepted, and state the dependency in description " +
  "(for example \"only if the invite was accepted\") so the rep knows the step is contingent.";

/** Prompt guidance injected into followup_suggest so channel assignment is explicit. */
export function buildChannelMixHint(mix: FollowupChannelMix): string {
  switch (mix) {
    case "email":
      return (
        "Channel mix: email only. Use cold_email or personalized_email (or website_form if that is the lead channel). " +
        "Do not use LinkedIn unless user instructions explicitly ask. Every step needs an emailSubject and follows the role word target."
      );
    case "linkedin":
      return (
        "Channel mix: LinkedIn only. " +
        `${LINKEDIN_CHANNEL_SEMANTICS} ` +
        `${LINKEDIN_LENGTH_RULES} ` +
        "Leave emailSubject empty on every step and write peer-note copy with no email formatting. " +
        `${LINKEDIN_ACCEPTANCE_RULE} ` +
        "Do not use email channels unless user instructions explicitly ask."
      );
    case "multi_channel":
      return (
        "Channel mix: Email + LinkedIn as ONE interleaved strategy. Do NOT put every step on the same channel. " +
        "Default full cadence: Step 1 linkedin_outbound connection request, Step 2 cold_email or personalized_email, " +
        "Step 3 linkedin_outbound follow-up note on a new angle, Step 4 email breakup. " +
        "Continue mode: alternate the remaining LinkedIn and email touches, starting with LinkedIn when possible. " +
        `${LINKEDIN_CHANNEL_SEMANTICS} ` +
        `${LINKEDIN_LENGTH_RULES} Email steps keep the normal role word target and require a subject. ` +
        `${LINKEDIN_ACCEPTANCE_RULE} The email steps must stand on their own so the sequence still works if the invite is never accepted. ` +
        "Cross-channel awareness: never restate an email in the LinkedIn note or the reverse. A LinkedIn step following an unanswered email may make at most one light " +
        "reference to it; never list prior attempts or imply the prospect ignored you. " +
        "LinkedIn steps use emailSubject \"\". Titles reflect the channel (for example \"LinkedIn 1 - Connect\", \"Email 1 - Intro\")."
      );
    case "lead":
    default:
      return (
        "Channel mix: match the lead's primary channel (or \"other\"). Keep all steps on that channel unless user instructions ask to mix. " +
        `If that channel is LinkedIn: ${LINKEDIN_LENGTH_RULES}`
      );
  }
}

/** Channels where we queue SMTP send; others stay copy + due-date reminders. */
const REMIND_ONLY_CHANNELS = new Set<ChannelKey>([
  "linkedin_outbound",
  "linkedin_1to1",
  "upwork",
  "job_apply",
]);

export function resolveFollowupChannel(
  channel: FollowupChannel | undefined,
  leadChannel: ChannelKey,
): ChannelKey {
  if (!channel || channel === "other") return leadChannel;
  return channel;
}

/** True when the step resolves to an email-sendable channel (not LinkedIn / Upwork / job apply). */
export function isFollowupEmailChannel(
  f: Pick<Followup, "channel">,
  leadChannel: ChannelKey,
): boolean {
  return !REMIND_ONLY_CHANNELS.has(resolveFollowupChannel(f.channel, leadChannel));
}

export type FollowupQueueKind = "email" | "linkedin" | "other";
export type FollowupChannelFilter = "all" | "email" | "linkedin";

/** Lead channel used when a followup has no lead, matching the Followups queue fallback. */
export function resolveFollowupLeadChannel(
  f: Pick<Followup, "channel">,
  leadChannel: ChannelKey | undefined,
): ChannelKey {
  if (leadChannel) return leadChannel;
  if (f.channel && f.channel !== "other") return f.channel;
  return "cold_email";
}

/** Queue grouping for the Followups screen (Email / LinkedIn / other). */
export function followupQueueKind(
  f: Pick<Followup, "channel">,
  leadChannel: ChannelKey,
): FollowupQueueKind {
  const resolved = resolveFollowupChannel(f.channel, leadChannel);
  if (resolved === "linkedin_outbound" || resolved === "linkedin_1to1") return "linkedin";
  if (isFollowupEmailChannel(f, leadChannel)) return "email";
  return "other";
}

export function matchesFollowupChannelFilter(
  f: Pick<Followup, "channel">,
  leadChannel: ChannelKey,
  filter: FollowupChannelFilter,
): boolean {
  if (filter === "all") return true;
  return followupQueueKind(f, leadChannel) === filter;
}

/**
 * List polls omit `messageBody` and set `hasMessageBody` instead
 * (`projectWorkspaceListPayload`). Live mappers must honor that flag or
 * email steps look empty after the first workspace refresh.
 */
export function resolveFollowupHasMessageBody(raw: {
  messageBody?: unknown;
  hasMessageBody?: unknown;
}): boolean {
  if (raw.hasMessageBody === true) return true;
  return typeof raw.messageBody === "string" && Boolean(raw.messageBody.trim());
}

/** True when this step can be auto-scheduled as outbound email. */
export function canAutoScheduleFollowupEmail(
  f: Followup,
  leadChannel: ChannelKey,
): boolean {
  // Prefer body / hasMessageBody. emailSubject covers live rows where list
  // projection omitted the body and the hasMessageBody flag was dropped.
  if (
    !f.messageBody?.trim() &&
    !f.hasMessageBody &&
    !f.emailSubject?.trim()
  ) {
    return false;
  }
  if (f.scheduledEmailId || f.pausedAt || f.completedAt) return false;
  return isFollowupEmailChannel(f, leadChannel);
}

export function sequenceModeLabel(mode: FollowupPlan["sequenceMode"]): string {
  if (mode === "continue") return "Continue";
  if (mode === "full") return "Full outreach";
  return "Sequence";
}

/**
 * Mix that preserves one step's channel shape, so regenerating a LinkedIn step
 * on an email lead does not come back as email copy.
 */
export function channelMixForFollowupChannel(
  channel: FollowupChannel | undefined,
  leadChannel: ChannelKey,
): FollowupChannelMix {
  const resolved = resolveFollowupChannel(channel, leadChannel);
  if (resolved === "linkedin_outbound" || resolved === "linkedin_1to1") return "linkedin";
  if (
    resolved === "cold_email" ||
    resolved === "personalized_email" ||
    resolved === "website_form"
  ) {
    return "email";
  }
  return "lead";
}

export function defaultFollowupChannelMix(input: {
  leadChannel: ChannelKey;
  hasLinkedIn: boolean;
  initialChannel?: ChannelKey;
}): FollowupChannelMix {
  const initial = input.initialChannel;
  if (initial === "linkedin_outbound" || initial === "linkedin_1to1") return "linkedin";
  if (input.hasLinkedIn) return "multi_channel";
  if (
    input.leadChannel === "cold_email" ||
    input.leadChannel === "personalized_email" ||
    input.leadChannel === "website_form"
  ) {
    return "email";
  }
  if (input.leadChannel === "linkedin_outbound" || input.leadChannel === "linkedin_1to1") {
    return "linkedin";
  }
  return "lead";
}

export function getPausedFollowupPlanForLead(
  plans: readonly FollowupPlan[],
  leadId: string,
): FollowupPlan | undefined {
  return plans
    .filter((p) => p.leadId === leadId && p.status === "paused")
    .sort((a, b) => (b.pausedAt ?? b.createdAt).localeCompare(a.pausedAt ?? a.createdAt))[0];
}

export function followupsForPlan(followups: readonly Followup[], planId: string): Followup[] {
  return followups.filter((f) => f.planId === planId);
}

export function openFollowupsForPlan(followups: readonly Followup[], planId: string): Followup[] {
  return followupsForPlan(followups, planId).filter((f) => !f.completedAt && !f.pausedAt);
}

export function pausedFollowupsForPlan(followups: readonly Followup[], planId: string): Followup[] {
  return followupsForPlan(followups, planId).filter((f) => !f.completedAt && f.pausedAt);
}

/**
 * Steps retired when a replan replaced their plan. They are cancelled rather
 * than deleted so delivery history and the lead timeline stay auditable.
 */
export const SUPERSEDED_STEP_CANCEL_REASON = "Superseded by regenerated sequence";

export function isSupersededFollowup(f: Pick<Followup, "cancelReason">): boolean {
  return f.cancelReason === SUPERSEDED_STEP_CANCEL_REASON;
}

/**
 * Steps a replan should retire: everything in the plan that was never actually
 * delivered. Includes steps already cancelled when the lead replied, since
 * those are just as dead once a new cadence takes over.
 */
export function retirableFollowupsForPlan(
  followups: readonly Followup[],
  planId: string,
): Followup[] {
  return followupsForPlan(followups, planId).filter(
    (f) => !f.completedAt && f.deliveryStatus !== "sent" && !isSupersededFollowup(f),
  );
}

/** Plans referenced by follow-ups but missing a plan row (legacy AI batch). */
export function synthesizePlansFromFollowups(
  followups: readonly Followup[],
  existingPlans: readonly FollowupPlan[],
): FollowupPlan[] {
  const known = new Set(existingPlans.map((p) => p.id));
  const out: FollowupPlan[] = [];
  const byPlan = new Map<string, Followup[]>();
  for (const f of followups) {
    if (!f.planId || !f.leadId || known.has(f.planId)) continue;
    const list = byPlan.get(f.planId) ?? [];
    list.push(f);
    byPlan.set(f.planId, list);
  }
  for (const [planId, items] of byPlan) {
    const leadId = items[0]?.leadId;
    const ownerId = items[0]?.ownerId;
    if (!leadId || !ownerId) continue;
    const earliest = items.reduce((min, f) => (f.dueAt < min ? f.dueAt : min), items[0].dueAt);
    out.push({
      id: planId,
      leadId,
      ownerId,
      status: items.some((f) => !f.completedAt && !f.pausedAt) ? "active" : "completed",
      planSummary: "Follow-up plan",
      kind: "sequence",
      createdAt: earliest,
    });
    known.add(planId);
  }
  return out;
}

export function mergeFollowupPlans(
  stored: readonly FollowupPlan[],
  followups: readonly Followup[],
): FollowupPlan[] {
  const synth = synthesizePlansFromFollowups(followups, stored);
  const followupsByPlan = new Map<string, Followup[]>();
  for (const f of followups) {
    if (!f.planId) continue;
    const list = followupsByPlan.get(f.planId);
    if (list) list.push(f);
    else followupsByPlan.set(f.planId, [f]);
  }
  const reconciled = stored.map((plan) => {
    if (plan.status !== "active") return plan;
    const steps = followupsByPlan.get(plan.id) ?? [];
    if (steps.length === 0 || steps.some((step) => !step.completedAt && step.deliveryStatus !== "sent")) {
      return plan;
    }
    const completedAt = steps
      .map((step) => step.completedAt ?? step.sentAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return { ...plan, status: "completed" as const, completedAt };
  });
  return [...reconciled, ...synth];
}

/** All known contact emails for a lead (company, personal, and any extras). */
export function leadContactEmails(
  lead: Pick<Lead, "contactEmail">,
  ...extras: (string | null | undefined)[]
): string[] {
  const emails = new Set<string>();
  const add = (v?: string | null) => {
    const e = v?.trim().toLowerCase();
    if (e && e.includes("@")) emails.add(e);
  };
  add(lead.contactEmail);
  for (const extra of extras) add(extra);
  return [...emails];
}

/** Lead emails plus linked contact company/personal addresses. */
export function leadEmailsWithContact(
  lead: Pick<Lead, "contactEmail">,
  contact?: Pick<{ email?: string; personalEmail?: string }, "email" | "personalEmail"> | null,
): string[] {
  return leadContactEmails(lead, contact?.email, contact?.personalEmail);
}

/**
 * Fast lookup: lowercase email → lead id (first lead wins on collisions).
 * Prefer this over scanning all leads per message in hot inbox loops.
 */
export function buildLeadEmailToIdMap(
  leads: readonly Pick<Lead, "id" | "contactEmail" | "contactId">[],
  contacts: readonly { id: string; email?: string; personalEmail?: string }[],
): Map<string, string> {
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const map = new Map<string, string>();
  for (const lead of leads) {
    const contact = lead.contactId ? contactById.get(lead.contactId) : undefined;
    for (const email of leadEmailsWithContact(lead, contact)) {
      if (!map.has(email)) map.set(email, lead.id);
    }
  }
  return map;
}
