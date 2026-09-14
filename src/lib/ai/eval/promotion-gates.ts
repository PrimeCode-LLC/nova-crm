/**
 * Pure promotion gate evaluation (unit-tested).
 * Judge win rate is display-only until JUDGE_GATES_PROMOTION is flipped after calibration.
 */

export const JUDGE_GATES_PROMOTION = false;

export type ScorecardGateInput = {
  offlinePassRate?: number | null;
  offlineHallucination?: number | null;
  judgeWinRate?: number | null;
  delivered?: number | null;
  maturityPct?: number | null;
  bounceRate?: number | null;
  positiveReplies?: number | null;
};

export type Gate = { id: string; passed: boolean; detail: string };

export function evaluateCanaryGates(scorecard: ScorecardGateInput | null): Gate[] {
  const passRate = scorecard?.offlinePassRate;
  const gates: Gate[] = [
    {
      id: "offline_pass",
      passed: passRate != null && passRate >= 0.9,
      detail:
        passRate == null
          ? "No completed offline eval (run eval first)"
          : `Offline pass rate ${(100 * passRate).toFixed(0)}% (need ≥90%)`,
    },
    {
      id: "hallucination",
      passed:
        scorecard?.offlineHallucination != null && scorecard.offlineHallucination === 0,
      detail:
        scorecard?.offlineHallucination == null
          ? "No completed offline eval (run eval first)"
          : `Hallucination failures: ${scorecard.offlineHallucination}`,
    },
  ];

  const judgeWin = scorecard?.judgeWinRate;
  if (JUDGE_GATES_PROMOTION) {
    gates.push({
      id: "judge_win",
      passed: judgeWin != null && judgeWin >= 0.55,
      detail:
        judgeWin == null
          ? "No pairwise judge results (run eval against default)"
          : `Judge win rate ${(100 * judgeWin).toFixed(0)}% (need ≥55%)`,
    });
  } else {
    gates.push({
      id: "judge_win",
      passed: true,
      detail:
        judgeWin == null
          ? "Judge win rate n/a — recorded when available; not gating until calibration >70%"
          : `Judge win rate ${(100 * judgeWin).toFixed(0)}% — display only until calibration >70%`,
    });
  }
  return gates;
}

export function evaluateDefaultGates(input: {
  variant: ScorecardGateInput | null;
  control: ScorecardGateInput | null;
  controlConfigId: string | null;
  /** Injected P(variant>control); computed by caller with beta helpers. */
  pBeat: number | null;
}): Gate[] {
  const scorecard = input.variant;
  const gates: Gate[] = [
    {
      id: "delivered",
      passed: (scorecard?.delivered ?? 0) >= 500,
      detail: `Delivered ${scorecard?.delivered ?? 0} (need ≥500)`,
    },
    {
      id: "maturity",
      passed: (scorecard?.maturityPct ?? 0) >= 0.6,
      detail: `Maturity ${((scorecard?.maturityPct ?? 0) * 100).toFixed(0)}% (need ≥60%)`,
    },
    {
      id: "bounce",
      passed: (scorecard?.bounceRate ?? 0) <= 0.03,
      detail: `Bounce rate ${((scorecard?.bounceRate ?? 0) * 100).toFixed(1)}% (need ≤3%)`,
    },
  ];

  if (scorecard && input.control && input.controlConfigId && input.pBeat != null) {
    gates.push({
      id: "posterior",
      passed: input.pBeat >= 0.8,
      detail: `P(variant>default)≈${input.pBeat.toFixed(2)} on positive reply rate (need ≥0.80 vs ${input.controlConfigId})`,
    });
  } else if (scorecard && !input.controlConfigId) {
    gates.push({
      id: "posterior",
      passed: true,
      detail: "No alternate default config to compare — posterior skipped",
    });
  } else {
    gates.push({
      id: "posterior",
      passed: false,
      detail: "Missing scorecard for variant or default control",
    });
  }
  return gates;
}
