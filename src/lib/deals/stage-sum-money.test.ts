import { describe, expect, it } from "vitest";

import {
  dealSumValueConflictsWithList,
  mapDealStageGroupSums,
  openWonDealMoneyFromStageSums,
} from "@/lib/deals/stage-sum-money";

describe("deal stage sums", () => {
  it("maps groupBy rows and drops a null sum", () => {
    expect(
      mapDealStageGroupSums([
        { stage: "discovery", _sum: { value: 1500 }, _count: { _all: 2 } },
        { stage: "won", _sum: { value: null }, _count: { _all: 1 } },
        { stage: "", _sum: { value: 9 }, _count: { _all: 1 } },
      ]),
    ).toEqual({
      discovery: { sum: 1500, count: 2 },
      won: { sum: 0, count: 1 },
    });
  });

  it("rejects sumValue combined with a list walk", () => {
    expect(
      dealSumValueConflictsWithList({ all: false, cursor: null, limitSpecified: false }),
    ).toBe(false);
    expect(
      dealSumValueConflictsWithList({ all: true, cursor: null, limitSpecified: false }),
    ).toBe(true);
    expect(
      dealSumValueConflictsWithList({ all: false, cursor: "2020-01-01|id", limitSpecified: false }),
    ).toBe(true);
    expect(
      dealSumValueConflictsWithList({ all: false, cursor: null, limitSpecified: true }),
    ).toBe(true);
  });

  it("collapses stages into open and won money", () => {
    expect(
      openWonDealMoneyFromStageSums({
        discovery: { sum: 100, count: 1 },
        proposal: { sum: 250, count: 2 },
        won: { sum: 900, count: 3 },
        lost: { sum: 40, count: 4 },
      }),
    ).toEqual({
      openSum: 350,
      openCount: 3,
      wonSum: 900,
      wonCount: 3,
    });
    expect(openWonDealMoneyFromStageSums(null)).toBeNull();
  });
});
