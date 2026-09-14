import { describe, expect, it } from "vitest";
import { levenshteinDistance } from "@/lib/ai/eval/types";

describe("outreach eval schema conventions", () => {
  it("documents the 11 tenant-scoped tables", () => {
    const tables = [
      "outreach_configs",
      "outreach_zone_pointers",
      "ai_generations",
      "sequence_step_provenance",
      "eval_dataset_items",
      "eval_runs",
      "eval_results",
      "experiments",
      "experiment_arms",
      "experiment_assignments",
      "outreach_config_scorecards",
    ];
    expect(tables).toHaveLength(11);
  });
});

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("counts edits", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });
});
