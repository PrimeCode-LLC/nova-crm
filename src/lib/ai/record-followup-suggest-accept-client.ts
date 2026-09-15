/**
 * Non-blocking client helper: record sequence_step_provenance after activate.
 * Failures must never block sequence creation.
 */

export async function recordFollowupSuggestAccept(input: {
  generationId?: string;
  configId?: string;
  planId: string;
  leadId: string;
  zone?: string;
  experimentId?: string | null;
  armId?: string | null;
  steps: Array<{
    followupId: string;
    stepIndex: number;
    channel?: string;
    subject?: string;
    body?: string;
  }>;
}): Promise<void> {
  if (!input.generationId?.trim() || !input.configId?.trim()) return;
  try {
    await fetch("/api/ai/followup-suggest/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationId: input.generationId,
        configId: input.configId,
        planId: input.planId,
        leadId: input.leadId,
        zone: input.zone ?? "default",
        experimentId: input.experimentId ?? undefined,
        variantId: input.armId ?? undefined,
        steps: input.steps,
      }),
    });
  } catch (e) {
    console.warn("[followup-suggest/accept] client record failed", e);
  }
}
