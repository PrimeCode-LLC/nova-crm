import { describe, expect, it } from "vitest";
import {
  interleaveLeadIdsForExperiment,
  reorderByExperimentShuffle,
} from "@/lib/ai/eval/experiment-shuffle";
import { seniorityBracketFromTitle } from "@/lib/ai/eval/segment-buckets";

describe("experiment-shuffle", () => {
  it("is deterministic", () => {
    const ids = ["l1", "l2", "l3", "l4", "l5"];
    expect(interleaveLeadIdsForExperiment("exp-a", ids)).toEqual(
      interleaveLeadIdsForExperiment("exp-a", [...ids].reverse()),
    );
  });

  it("reorders items by lead key", () => {
    const items = [
      { key: "b", n: 1 },
      { key: "a", n: 2 },
      { key: "c", n: 3 },
    ];
    const ordered = reorderByExperimentShuffle({
      experimentId: "exp-1",
      items,
      leadIdOf: (i) => i.key,
    });
    expect(ordered.map((i) => i.key).sort()).toEqual(["a", "b", "c"]);
    expect(ordered).toHaveLength(3);
  });
});

describe("seniorityBracketFromTitle", () => {
  it("maps common titles", () => {
    expect(seniorityBracketFromTitle("CEO")).toBe("c_level");
    expect(seniorityBracketFromTitle("VP Engineering")).toBe("vp");
    expect(seniorityBracketFromTitle("Director of Sales")).toBe("director");
    expect(seniorityBracketFromTitle("Engineering Manager")).toBe("manager");
    expect(seniorityBracketFromTitle("Senior Engineer")).toBe("senior_ic");
    expect(seniorityBracketFromTitle("Software Engineer")).toBe("ic");
  });
});
