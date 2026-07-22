import type { Account, Contact, Lead } from "@/lib/types";
import type { IntentEvidence } from "@/lib/prospecting-strategy/qualify";
import { evidenceAgeDays } from "@/lib/prospecting-strategy/qualify";

export type AccountSegment = "smb" | "mid_market" | "enterprise" | "unknown";

/** Maps CompanySize enum values to a rough go-to-market segment. */
const SIZE_TIER: Record<string, AccountSegment> = {
  solo: "smb",
  "1-10": "smb",
  "11-50": "smb",
  "51-200": "smb",
  "201-500": "mid_market",
  "501-1000": "mid_market",
  "1001-5000": "enterprise",
  "5001+": "enterprise",
};

/** Maps RevenueRange enum values to a rough go-to-market segment. */
const REVENUE_TIER: Record<string, AccountSegment> = {
  lt_1m: "smb",
  "1m_10m": "smb",
  "10m_50m": "mid_market",
  "50m_100m": "mid_market",
  "100m_500m": "enterprise",
  "500m_1b": "enterprise",
  gt_1b: "enterprise",
};

const SEGMENT_RANK: Record<AccountSegment, number> = {
  unknown: -1,
  smb: 0,
  mid_market: 1,
  enterprise: 2,
};

/**
 * Deterministic segment classification shared by the AI path and the fallback.
 * Takes the higher of the size-derived and revenue-derived tier; falls back to
 * account-level fields when the lead snapshot is missing them.
 */
export function classifyAccountSegment(input: { lead: Lead; account?: Account }): AccountSegment {
  const { lead, account } = input;
  const size = lead.companySize ?? account?.size;
  const revenue = lead.revenueRange ?? account?.revenueRange;
  const sizeTier: AccountSegment = size ? SIZE_TIER[size] ?? "unknown" : "unknown";
  const revenueTier: AccountSegment =
    revenue && revenue !== "unknown" ? REVENUE_TIER[revenue] ?? "unknown" : "unknown";
  return [sizeTier, revenueTier].reduce<AccountSegment>(
    (best, tier) => (SEGMENT_RANK[tier] > SEGMENT_RANK[best] ? tier : best),
    "unknown",
  );
}

export type LeadSignalProfile = {
  segment: AccountSegment;
  sizeLabel: string | null;
  revenueLabel: string | null;
  authorityHint: string | null;
  timelineHint: string | null;
  needHint: string | null;
  qualityScore: number | null;
  primaryOpportunity: string | null;
  freshestSignal: {
    text: string;
    ageDays: number | null;
    strength: "strong" | "medium" | null;
  } | null;
  techStack: string[];
  bestContactChannel: string | null;
};

function authorityHint(authority: number): string | null {
  if (!Number.isFinite(authority) || authority <= 0) return null;
  if (authority >= 4)
    return "Likely a final decision-maker — you may address the decision directly.";
  if (authority === 3)
    return "Shared authority / strong influencer — advance it internally and keep it easy to forward up.";
  return "Likely an influencer or gatekeeper, not the signer — win them as a champion and make the email forwardable to the real decision-maker.";
}

function timelineHint(timeline: number): string | null {
  if (!Number.isFinite(timeline) || timeline <= 0) return null;
  if (timeline >= 4)
    return "Active / near-term timeline — a concrete next step is appropriate once interest shows.";
  if (timeline === 3) return "Medium timeline — advance gently; do not force a meeting.";
  return "No clear timeline — stay curiosity-led; do not push a calendar ask.";
}

function needHint(need: number): string | null {
  if (!Number.isFinite(need) || need <= 0) return null;
  if (need >= 4) return "Need is established — you may speak to the problem directly.";
  if (need === 3) return "Need is partial — connect the signal to a likely problem.";
  return "Need is unproven — present value as a hypothesis, never as a known fact.";
}

function clampSignalText(value: string): string {
  const t = value.trim();
  return t.length > 180 ? `${t.slice(0, 177).trimEnd()}…` : t;
}

/** Picks the strongest, then most recent, complete intent-evidence entry. */
function pickFreshestEvidence(
  evidence: IntentEvidence[] | undefined,
): LeadSignalProfile["freshestSignal"] {
  if (!evidence?.length) return null;
  const candidates = evidence
    .filter((e) => e.label?.trim())
    .map((e) => ({
      entry: e,
      age: e.observedAt ? evidenceAgeDays(e.observedAt) : null,
      strengthRank: e.strength === "strong" ? 2 : 1,
    }));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (b.strengthRank !== a.strengthRank) return b.strengthRank - a.strengthRank;
    const aAge = a.age ?? Number.POSITIVE_INFINITY;
    const bAge = b.age ?? Number.POSITIVE_INFINITY;
    return aAge - bAge;
  });
  const top = candidates[0];
  return {
    text: clampSignalText(top.entry.label),
    ageDays: top.age,
    strength: top.entry.strength === "strong" ? "strong" : "medium",
  };
}

/** Falls back to dated free-text research fields, matching the demo signal priority. */
function fallbackSignal(lead: Lead): LeadSignalProfile["freshestSignal"] {
  const pick =
    lead.recentNews ||
    lead.triggerEvent ||
    lead.hiringSignals ||
    lead.businessFocus ||
    lead.painPoints;
  if (!pick?.trim()) return null;
  return { text: clampSignalText(pick), ageDays: null, strength: null };
}

/**
 * Precomputes the high-signal, decision-relevant fields for outreach so the model
 * does not have to mine them out of the full lead JSON. Purely deterministic.
 */
export function buildLeadSignalProfile(input: {
  lead: Lead;
  account?: Account;
  contact?: Contact;
}): LeadSignalProfile {
  const { lead, account, contact } = input;
  const bant = lead.bant;
  const techStack = (account?.techStack?.length ? account.techStack : lead.toolsUsed ?? []).slice(
    0,
    6,
  );
  const revenueLabel =
    (lead.revenueRange && lead.revenueRange !== "unknown" ? lead.revenueRange : undefined) ??
    account?.revenueRange ??
    null;

  return {
    segment: classifyAccountSegment({ lead, account }),
    sizeLabel: lead.companySize ?? account?.size ?? null,
    revenueLabel,
    authorityHint: bant ? authorityHint(bant.authority) : null,
    timelineHint: bant ? timelineHint(bant.timeline) : null,
    needHint: bant ? needHint(bant.need) : null,
    qualityScore: typeof lead.qualityScore === "number" ? lead.qualityScore : null,
    primaryOpportunity: lead.primaryOpportunityLabel?.trim() || null,
    freshestSignal: pickFreshestEvidence(lead.intentEvidence) ?? fallbackSignal(lead),
    techStack,
    bestContactChannel: contact?.bestContactChannel ?? null,
  };
}

const SEGMENT_LABEL: Record<AccountSegment, string> = {
  smb: "SMB (small / founder-led — usually the direct decision-maker; you may move faster)",
  mid_market:
    "Mid-market (a small buying group is likely — balance directness with forwardable copy)",
  enterprise:
    "Enterprise (assume a buying committee — lower the ask and write forwardable copy)",
  unknown: "unknown (do not assume company scale; keep claims scale-agnostic)",
};

/** Compact block for prompt vars so the model cannot miss the precomputed deal signals. */
export function formatLeadSignalGuidance(profile: LeadSignalProfile): string {
  const lines: string[] = [];
  const sizeBits = [
    profile.sizeLabel ? `size ${profile.sizeLabel}` : null,
    profile.revenueLabel ? `revenue ${profile.revenueLabel}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  lines.push(
    `Account segment: ${SEGMENT_LABEL[profile.segment]}${sizeBits ? ` [${sizeBits}]` : ""}`,
  );
  if (profile.authorityHint) lines.push(`Decision authority: ${profile.authorityHint}`);
  if (profile.timelineHint) lines.push(`Timeline: ${profile.timelineHint}`);
  if (profile.needHint) lines.push(`Need: ${profile.needHint}`);
  if (profile.primaryOpportunity)
    lines.push(`Primary opportunity / angle to pitch: ${profile.primaryOpportunity}`);
  if (profile.freshestSignal) {
    const { ageDays, strength, text } = profile.freshestSignal;
    const ageBit =
      ageDays != null
        ? ` (~${ageDays}d old${ageDays > 60 ? " — likely stale, use only if nothing fresher exists" : ""})`
        : "";
    lines.push(
      `Strongest recent ${strength ? `${strength} signal` : "signal"} to open around: ${text}${ageBit}`,
    );
  }
  if (profile.techStack.length)
    lines.push(
      `Known tech/tools (reference for technical roles only; never invent): ${profile.techStack.join(", ")}`,
    );
  if (profile.qualityScore != null) {
    const note =
      profile.qualityScore >= 70
        ? " (high — a more direct ask is justified)"
        : profile.qualityScore < 40
          ? " (low — stay soft and curiosity-led)"
          : "";
    lines.push(`Intent quality score: ${profile.qualityScore}/100${note}`);
  }
  if (profile.bestContactChannel)
    lines.push(`Preferred contact channel: ${profile.bestContactChannel}`);
  return lines.join("\n");
}
