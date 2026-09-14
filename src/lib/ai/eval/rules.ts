/**
 * Offline eval rule engine for AI email sequences.
 * Pure functions — no I/O.
 */

export type RuleSeverity = "block" | "warn";

export type RuleResult = {
  id: string;
  severity: RuleSeverity;
  passed: boolean;
  detail: string;
};

export type EvalSequenceStep = {
  stepIndex: number;
  subject?: string;
  body: string;
  channel?: string;
  dueOffsetDays?: number;
};

export type EvalSequenceInput = {
  steps: EvalSequenceStep[];
  /** Flattened lead/context text used for grounding checks. */
  contextText: string;
  /** Optional role word-count bracket from followup-personalization. */
  wordTargetMin?: number;
  wordTargetMax?: number;
};

const FALSE_PRIOR_CONTACT_RE =
  /\b(as discussed|as we discussed|following up on our (conversation|call|meeting)|great (speaking|talking|chatting) with you|per our (last )?(call|conversation)|nice (speaking|talking) (with|to) you)\b/i;

const BANNED_PHRASES_RE =
  /\b(i hope this email finds you well|just circling back|just bumping this|quick question|dear sir\/?madam|to whom it may concern)\b/i;

const MERGE_TOKEN_RE = /\{\{[^}]+\}\}|%\w+%|\[\[.+?\]\]/;

const CTA_RE =
  /\b(book|schedule|grab|set up|hop on|call|chat|meet|reply|let me know|are you open|would you be|can we|do you have)\b/i;

const URL_RE = /https?:\/\/|www\./i;

const ABOUT_SENDER_OPENER_RE =
  /^(i('m| am)|my name is|we are|we're|this is)\b/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Approximate Flesch-Kincaid grade (rough). */
export function readingGrade(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const syllables = words.reduce((sum, w) => {
    const m = w.toLowerCase().replace(/[^a-z]/g, "").match(/[aeiouy]+/g);
    return sum + Math.max(1, m?.length ?? 1);
  }, 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

function extractCandidateEntities(text: string): string[] {
  const out = new Set<string>();
  // Capitalized multi-word names / companies
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    if (m[1]) out.add(m[1]);
  }
  // Dollar / percent / large numbers
  for (const m of text.matchAll(/\$[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\b\d{4}\b/g)) {
    if (m[0]) out.add(m[0]);
  }
  return [...out];
}

export function evaluateSequenceRules(input: EvalSequenceInput): RuleResult[] {
  const results: RuleResult[] = [];
  const steps = input.steps ?? [];
  const contextLower = (input.contextText ?? "").toLowerCase();

  if (steps.length === 0) {
    results.push({
      id: "empty_sequence",
      severity: "block",
      passed: false,
      detail: "Sequence has no steps",
    });
    return results;
  }

  if (steps.length > 5) {
    results.push({
      id: "too_many_steps",
      severity: "warn",
      passed: false,
      detail: `Sequence has ${steps.length} steps (max recommended 5)`,
    });
  } else {
    results.push({
      id: "too_many_steps",
      severity: "warn",
      passed: true,
      detail: "Step count within limit",
    });
  }

  const openers: string[] = [];

  for (const step of steps) {
    const body = step.body ?? "";
    const subject = step.subject ?? "";
    const label = `step ${step.stepIndex + 1}`;

    // Blocking: false prior contact
    const falsePrior = FALSE_PRIOR_CONTACT_RE.test(body) || FALSE_PRIOR_CONTACT_RE.test(subject);
    results.push({
      id: `false_prior_contact_${step.stepIndex}`,
      severity: "block",
      passed: !falsePrior,
      detail: falsePrior
        ? `${label}: claims prior contact without evidence`
        : `${label}: no false prior-contact claim`,
    });

    // Blocking: unresolved merge tokens
    const hasToken = MERGE_TOKEN_RE.test(body) || MERGE_TOKEN_RE.test(subject);
    results.push({
      id: `unresolved_tokens_${step.stepIndex}`,
      severity: "block",
      passed: !hasToken,
      detail: hasToken
        ? `${label}: unresolved personalization token`
        : `${label}: tokens resolved`,
    });

    // Blocking: multiple CTAs (count CTA-ish sentences)
    const sentences = body.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    const ctaCount = sentences.filter((s) => CTA_RE.test(s)).length;
    results.push({
      id: `single_cta_${step.stepIndex}`,
      severity: "block",
      passed: ctaCount <= 1,
      detail:
        ctaCount > 1
          ? `${label}: ${ctaCount} call-to-action sentences (want ≤1)`
          : `${label}: CTA count ok`,
    });

    // Blocking: link in step 1
    if (step.stepIndex === 0) {
      const hasLink = URL_RE.test(body) || URL_RE.test(subject);
      results.push({
        id: `no_link_step1`,
        severity: "block",
        passed: !hasLink,
        detail: hasLink ? "Step 1 contains a link" : "Step 1 has no link",
      });
    }

    // Blocking: entity grounding
    const entities = extractCandidateEntities(`${subject} ${body}`);
    const ungrounded = entities.filter((e) => !contextLower.includes(e.toLowerCase()));
    // Ignore common English that looks capitalized at sentence start
    const realUngrounded = ungrounded.filter(
      (e) => !/^(The|This|That|Your|Our|Hi|Hello|Thanks|Thank)\b/.test(e),
    );
    results.push({
      id: `entity_grounding_${step.stepIndex}`,
      severity: "block",
      passed: realUngrounded.length === 0,
      detail:
        realUngrounded.length > 0
          ? `${label}: ungrounded entities: ${realUngrounded.slice(0, 5).join(", ")}`
          : `${label}: entities grounded in context`,
    });

    // Warn: banned phrases
    const banned = BANNED_PHRASES_RE.test(body) || BANNED_PHRASES_RE.test(subject);
    results.push({
      id: `banned_phrases_${step.stepIndex}`,
      severity: "warn",
      passed: !banned,
      detail: banned ? `${label}: contains banned phrase` : `${label}: no banned phrases`,
    });

    // Warn: subject length
    const subjectWords = wordCount(subject);
    results.push({
      id: `subject_length_${step.stepIndex}`,
      severity: "warn",
      passed: !subject || subjectWords <= 4,
      detail:
        subject && subjectWords > 4
          ? `${label}: subject has ${subjectWords} words (want ≤4)`
          : `${label}: subject length ok`,
    });

    // Warn: word count bracket (step 1 especially)
    if (step.stepIndex === 0 && (input.wordTargetMin || input.wordTargetMax)) {
      const wc = wordCount(body);
      const min = input.wordTargetMin ?? 0;
      const max = input.wordTargetMax ?? 10_000;
      const ok = wc >= min && wc <= max;
      results.push({
        id: `word_count_step1`,
        severity: "warn",
        passed: ok,
        detail: ok
          ? `Step 1 word count ${wc} within [${min}, ${max}]`
          : `Step 1 word count ${wc} outside [${min}, ${max}]`,
      });
    }

    // Warn: reading grade
    const grade = readingGrade(body);
    results.push({
      id: `reading_grade_${step.stepIndex}`,
      severity: "warn",
      passed: grade <= 8.5,
      detail:
        grade > 8.5
          ? `${label}: reading grade ~${grade.toFixed(1)} (want ≤8)`
          : `${label}: reading grade ok (~${grade.toFixed(1)})`,
    });

    // Warn: first sentence about sender
    const firstSentence = sentences[0] ?? "";
    const aboutSender = ABOUT_SENDER_OPENER_RE.test(firstSentence);
    results.push({
      id: `opener_not_about_sender_${step.stepIndex}`,
      severity: "warn",
      passed: !aboutSender,
      detail: aboutSender
        ? `${label}: opens about the sender`
        : `${label}: opener not about sender`,
    });

    openers.push(firstSentence.toLowerCase().slice(0, 40));
  }

  // Warn: duplicate openers
  const openerSet = new Set(openers.filter(Boolean));
  results.push({
    id: "duplicate_openers",
    severity: "warn",
    passed: openerSet.size === openers.filter(Boolean).length,
    detail:
      openerSet.size === openers.filter(Boolean).length
        ? "Openers are unique across steps"
        : "Duplicate openers across steps",
  });

  // Warn: cadence spacing
  const offsets = steps
    .map((s) => s.dueOffsetDays)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  if (offsets.length >= 2) {
    let spacingOk = true;
    for (let i = 1; i < offsets.length; i++) {
      if ((offsets[i] ?? 0) - (offsets[i - 1] ?? 0) < 1) spacingOk = false;
    }
    results.push({
      id: "cadence_spacing",
      severity: "warn",
      passed: spacingOk,
      detail: spacingOk ? "Cadence day spacing ok" : "Cadence steps collide on same day",
    });
  }

  return results;
}

export function summarizeRuleResults(results: RuleResult[]): {
  passed: boolean;
  blockFailures: RuleResult[];
  warnFailures: RuleResult[];
  hallucinationCount: number;
} {
  const blockFailures = results.filter((r) => r.severity === "block" && !r.passed);
  const warnFailures = results.filter((r) => r.severity === "warn" && !r.passed);
  const hallucinationCount = results.filter(
    (r) =>
      !r.passed &&
      (r.id.startsWith("entity_grounding_") || r.id.startsWith("false_prior_contact_")),
  ).length;
  return {
    passed: blockFailures.length === 0,
    blockFailures,
    warnFailures,
    hallucinationCount,
  };
}
