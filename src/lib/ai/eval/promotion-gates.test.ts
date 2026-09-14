import { describe, expect, it } from "vitest";
import {
  evaluateCanaryGates,
  evaluateDefaultGates,
} from "@/lib/ai/eval/promotion-gates";

describe("evaluateCanaryGates", () => {
  it("fails when no offline eval has run (null pass rate)", () => {
    const gates = evaluateCanaryGates(null);
    expect(gates.find((g) => g.id === "offline_pass")?.passed).toBe(false);
    expect(gates.find((g) => g.id === "hallucination")?.passed).toBe(false);
  });

  it("passes offline gates when pass rate ≥90% and zero hallucinations", () => {
    const gates = evaluateCanaryGates({
      offlinePassRate: 0.95,
      offlineHallucination: 0,
      judgeWinRate: 0.6,
    });
    expect(gates.find((g) => g.id === "offline_pass")?.passed).toBe(true);
    expect(gates.find((g) => g.id === "hallucination")?.passed).toBe(true);
    // Judge is display-only until calibration — always passes.
    expect(gates.find((g) => g.id === "judge_win")?.passed).toBe(true);
  });

  it("fails offline_pass below 90%", () => {
    const gates = evaluateCanaryGates({
      offlinePassRate: 0.8,
      offlineHallucination: 0,
    });
    expect(gates.find((g) => g.id === "offline_pass")?.passed).toBe(false);
  });
});

describe("evaluateDefaultGates", () => {
  it("requires delivered ≥500 and maturity ≥60%", () => {
    const gates = evaluateDefaultGates({
      variant: { delivered: 100, maturityPct: 0.3, bounceRate: 0, positiveReplies: 2 },
      control: { delivered: 1000, positiveReplies: 20 },
      controlConfigId: "cfg-control",
      pBeat: 0.9,
    });
    expect(gates.find((g) => g.id === "delivered")?.passed).toBe(false);
    expect(gates.find((g) => g.id === "maturity")?.passed).toBe(false);
  });

  it("requires P(variant>control) ≥ 0.8 against real control", () => {
    const fail = evaluateDefaultGates({
      variant: { delivered: 600, maturityPct: 0.7, bounceRate: 0.01, positiveReplies: 30 },
      control: { delivered: 1000, positiveReplies: 40 },
      controlConfigId: "cfg-control",
      pBeat: 0.55,
    });
    expect(fail.find((g) => g.id === "posterior")?.passed).toBe(false);

    const pass = evaluateDefaultGates({
      variant: { delivered: 600, maturityPct: 0.7, bounceRate: 0.01, positiveReplies: 50 },
      control: { delivered: 1000, positiveReplies: 20 },
      controlConfigId: "cfg-control",
      pBeat: 0.91,
    });
    expect(pass.find((g) => g.id === "posterior")?.passed).toBe(true);
  });

  it("skips posterior when promoting with no alternate default", () => {
    const gates = evaluateDefaultGates({
      variant: { delivered: 600, maturityPct: 0.7, bounceRate: 0.01 },
      control: null,
      controlConfigId: null,
      pBeat: null,
    });
    expect(gates.find((g) => g.id === "posterior")?.passed).toBe(true);
  });
});
