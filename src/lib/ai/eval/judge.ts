/**
 * Pairwise LLM judge stub + calibration helpers.
 * Absolute 1-5 scoring is intentionally not implemented.
 */

import { z } from "zod";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";

export const pairwiseJudgeSchema = z.object({
  winner: z.enum(["A", "B", "tie"]),
  rationale: z.string(),
  scores: z.object({
    specificity: z.number().min(0).max(1),
    relevance: z.number().min(0).max(1),
    ctaClarity: z.number().min(0).max(1),
    toneFit: z.number().min(0).max(1),
    replyLikelihood: z.number().min(0).max(1),
  }),
});

export type PairwiseJudgeResult = z.infer<typeof pairwiseJudgeSchema>;

/**
 * Compare two sequence drafts on the same lead context.
 * Randomizes A/B position to cancel order bias; maps winner back to original labels.
 */
export async function judgePairwise(input: {
  organizationId: string;
  userId: string;
  leadContext: string;
  draftLeft: string;
  draftRight: string;
  leftLabel?: "control" | "variant";
  rightLabel?: "control" | "variant";
}): Promise<
  | { ok: true; result: PairwiseJudgeResult; swapped: boolean; winnerLabel: string }
  | { ok: false; error: string }
> {
  const swap = Math.random() < 0.5;
  const a = swap ? input.draftRight : input.draftLeft;
  const b = swap ? input.draftLeft : input.draftRight;
  try {
    const { output } = await runAiStructuredFeature({
      organizationId: input.organizationId,
      userId: input.userId,
      feature: "followup_suggest",
      zone: "lab",
      systemPromptOverride: `You are a cold-email quality judge. Compare draft A vs draft B for the same lead.
Prefer specificity, grounded relevance, clear single CTA, ICP tone fit, and reply likelihood.
Return winner A, B, or tie. Do not reward provocative openers that only generate angry replies.`,
      userPromptOverride: `Lead context:\n${input.leadContext}\n\nDraft A:\n${a}\n\nDraft B:\n${b}`,
      promptVars: {},
      schema: pairwiseJudgeSchema,
    });

    let winner = output.winner;
    if (swap && winner === "A") winner = "B";
    else if (swap && winner === "B") winner = "A";

    const leftLabel = input.leftLabel ?? "control";
    const rightLabel = input.rightLabel ?? "variant";
    const winnerLabel =
      winner === "tie" ? "tie" : winner === "A" ? leftLabel : rightLabel;

    return {
      ok: true,
      result: { ...output, winner },
      swapped: swap,
      winnerLabel,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Simple agreement rate between judge winners and human labels. Gate: >0.7 */
export function judgeHumanAgreement(
  pairs: Array<{ judgeWinner: string; humanWinner: string }>,
): number {
  if (pairs.length === 0) return 0;
  const agree = pairs.filter((p) => p.judgeWinner === p.humanWinner).length;
  return agree / pairs.length;
}
