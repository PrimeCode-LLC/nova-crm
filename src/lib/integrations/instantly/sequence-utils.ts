import type { InstantlyCampaign, InstantlySequenceStep } from "./types";

export type SequenceStepDraft = {
  delay: number;
  subject: string;
  body: string;
};

export const DEFAULT_SEQUENCE_STEP: SequenceStepDraft = {
  delay: 3,
  subject: "",
  body: "",
};

/** Map Instantly campaign sequences to editable drafts (first variant per step). */
export function remoteSequenceToDrafts(remote: InstantlyCampaign | null | undefined): SequenceStepDraft[] {
  const steps = remote?.sequences?.[0]?.steps;
  if (!steps?.length) {
    return [{ ...DEFAULT_SEQUENCE_STEP }];
  }
  return steps.map((step, i) => {
    const variant = step.variants?.[0];
    return {
      delay: i === 0 ? 0 : (step.delay ?? 3),
      subject: variant?.subject ?? "",
      body: variant?.body ?? "",
    };
  });
}

/** Build Instantly API sequence payload (only first sequence is used by Instantly). */
export function draftsToInstantlySteps(drafts: SequenceStepDraft[]): InstantlySequenceStep[] {
  return drafts.map((d, i) => ({
    type: "email" as const,
    ...(i > 0 ? { delay: d.delay > 0 ? d.delay : 3 } : {}),
    variants: [
      {
        subject: d.subject.trim(),
        body: d.body.trim(),
      },
    ],
  }));
}
