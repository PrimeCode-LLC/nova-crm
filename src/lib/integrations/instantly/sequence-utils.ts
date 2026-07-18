import type { InstantlyCampaign, InstantlySequenceStep } from "./types";
import { SEQUENCE_BUSINESS_DAY_GAPS } from "@/lib/followup-date";

export type SequenceStepDraft = {
  delay: number;
  subject: string;
  body: string;
};

/** Delay after previous step: Initial 0, then +3 / +5 / +7 (matches prospect follow-up cadence). */
export function delayForSequenceStep(stepIndex: number): number {
  if (stepIndex <= 0) return 0;
  if (stepIndex < SEQUENCE_BUSINESS_DAY_GAPS.length) {
    return SEQUENCE_BUSINESS_DAY_GAPS[stepIndex]!;
  }
  return 7;
}

export const DEFAULT_SEQUENCE_STEP: SequenceStepDraft = {
  delay: 0,
  subject: "",
  body: "",
};

export function defaultSequenceStepAt(stepIndex: number): SequenceStepDraft {
  return {
    delay: delayForSequenceStep(stepIndex),
    subject: "",
    body: "",
  };
}

/** Map Instantly campaign sequences to editable drafts (first variant per step). */
export function remoteSequenceToDrafts(remote: InstantlyCampaign | null | undefined): SequenceStepDraft[] {
  const steps = remote?.sequences?.[0]?.steps;
  if (!steps?.length) {
    return [defaultSequenceStepAt(0)];
  }
  return steps.map((step, i) => {
    const variant = step.variants?.[0];
    return {
      delay: i === 0 ? 0 : (step.delay ?? delayForSequenceStep(i)),
      subject: variant?.subject ?? "",
      body: variant?.body ?? "",
    };
  });
}

/** Build Instantly API sequence payload (only first sequence is used by Instantly). */
export function draftsToInstantlySteps(drafts: SequenceStepDraft[]): InstantlySequenceStep[] {
  return drafts.map((d, i) => ({
    type: "email" as const,
    ...(i > 0 ? { delay: d.delay > 0 ? d.delay : delayForSequenceStep(i) } : {}),
    variants: [
      {
        subject: d.subject.trim(),
        body: d.body.trim(),
      },
    ],
  }));
}
