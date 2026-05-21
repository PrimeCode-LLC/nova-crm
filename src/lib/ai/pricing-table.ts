/** USD per 1M tokens — estimates for admin usage display only. */
export const AI_MODEL_PRICING: Record<
  string,
  { inputPer1M: number; outputPer1M: number }
> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.8, outputPer1M: 4 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0 },
};

export function estimateTokenCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = AI_MODEL_PRICING[model] ?? { inputPer1M: 1, outputPer1M: 3 };
  return (
    (inputTokens / 1_000_000) * rates.inputPer1M +
    (outputTokens / 1_000_000) * rates.outputPer1M
  );
}

export function formatUsd(n: number): string {
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
