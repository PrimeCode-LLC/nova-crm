import { describe, expect, it } from "vitest";
import { assignLeadsToArms, pickArmId } from "@/lib/ai/eval/assignment-server";

describe("experiment assignment", () => {
  it("is deterministic per lead", () => {
    const arms = [
      { id: "a", allocation: 50 },
      { id: "b", allocation: 50 },
    ];
    const first = pickArmId("exp1", "lead-9", arms);
    const second = pickArmId("exp1", "lead-9", arms);
    expect(first).toBe(second);
  });

  it("spreads roughly evenly across arms", () => {
    const leadIds = Array.from({ length: 200 }, (_, i) => `lead-${i}`);
    const result = assignLeadsToArms({
      experimentId: "exp-balance",
      leadIds,
      arms: [
        { id: "control", allocation: 50, configId: "c1", label: "A", isControl: true },
        { id: "variant", allocation: 50, configId: "c2", label: "B" },
      ],
    });
    const a = result.filter((r) => r.armId === "control").length;
    const b = result.filter((r) => r.armId === "variant").length;
    expect(Math.abs(a - b)).toBeLessThan(40);
  });
});
