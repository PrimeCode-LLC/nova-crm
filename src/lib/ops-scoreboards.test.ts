import { describe, expect, it } from "vitest";
import {
  isOpsScoreboardsRange,
  opsScoreboardsCacheKey,
} from "@/lib/ops-scoreboards";

describe("ops scoreboards cache keys (P0.13)", () => {
  it("builds a versioned org+range key", () => {
    expect(opsScoreboardsCacheKey("org_1", "30d")).toBe(
      "dash:ops-scoreboards:v1:org_1:30d",
    );
  });

  it("trims organization id", () => {
    expect(opsScoreboardsCacheKey("  org_1  ", "7d")).toBe(
      "dash:ops-scoreboards:v1:org_1:7d",
    );
  });

  it("accepts dashboard ranges including team-command windows", () => {
    for (const range of ["today", "12h", "1d", "7d", "30d", "90d", "qtd", "ytd", "all"]) {
      expect(isOpsScoreboardsRange(range)).toBe(true);
    }
    expect(isOpsScoreboardsRange("bogus")).toBe(false);
  });
});
