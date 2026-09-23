import { describe, expect, it } from "vitest";
import {
  findStrategyDayProgress,
  LEAD_ID_HYDRATION_BATCH,
  planLeadHydrationBatches,
} from "@/hooks/use-snapshot-crm";
import type { StrategyDayProgress } from "@/lib/prospecting-strategy/progress";

describe("planLeadHydrationBatches", () => {
  it("keeps the first 100 sorted ids when hydrateAll is off", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `lead-${String(i).padStart(3, "0")}`);
    const batches = planLeadHydrationBatches(ids);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(LEAD_ID_HYDRATION_BATCH);
    expect(batches[0]?.[0]).toBe("lead-000");
    expect(batches[0]?.at(-1)).toBe("lead-099");
  });

  it("chunks every id when hydrateAll is on so a visible page past 100 still loads", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const batches = planLeadHydrationBatches(ids, { hydrateAll: true });
    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toHaveLength(250);
    expect(batches[2]?.at(-1)).toBe("id-249");
  });

  it("drops blanks and duplicates", () => {
    expect(planLeadHydrationBatches([" b ", "a", "a", "", "b"], { hydrateAll: true })).toEqual([
      ["a", "b"],
    ]);
  });
});

describe("findStrategyDayProgress", () => {
  const progress = { researched: 2 } as StrategyDayProgress;

  it("matches a user and assignment set regardless of order", () => {
    const found = findStrategyDayProgress(
      [
        { userId: "user-1", strategyAssignmentIds: ["b", "a"], progress },
        { userId: "user-2", strategyAssignmentIds: ["a"], progress: { researched: 9 } as StrategyDayProgress },
      ],
      "user-1",
      ["a", "b"],
    );
    expect(found?.researched).toBe(2);
  });
});
