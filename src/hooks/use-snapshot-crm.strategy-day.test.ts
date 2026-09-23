import { describe, expect, it } from "vitest";
import {
  STRATEGY_DAY_MAX_PAGES,
  strategyDayShouldFetchAnotherPage,
} from "@/hooks/use-snapshot-crm";

describe("strategy day paging", () => {
  it("continues past the old 4-page stop while the window still has rows", () => {
    expect(strategyDayShouldFetchAnotherPage(4, true, "cursor-5")).toBe(true);
  });

  it("stops when the API is exhausted or the safety cap is hit", () => {
    expect(strategyDayShouldFetchAnotherPage(2, false, "cursor")).toBe(false);
    expect(strategyDayShouldFetchAnotherPage(2, true, null)).toBe(false);
    expect(strategyDayShouldFetchAnotherPage(STRATEGY_DAY_MAX_PAGES, true, "cursor")).toBe(false);
  });
});