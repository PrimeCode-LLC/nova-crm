import { describe, expect, it } from "vitest";
import {
  isFollowupChannelFilter,
  isFollowupPageSize,
  pageNumbersWithEllipsis,
} from "@/lib/followup-queue-pagination";

describe("followup queue pagination", () => {
  it("accepts known page sizes and channel filters", () => {
    expect(isFollowupPageSize(10)).toBe(true);
    expect(isFollowupPageSize(20)).toBe(true);
    expect(isFollowupPageSize(50)).toBe(true);
    expect(isFollowupPageSize(100)).toBe(true);
    expect(isFollowupPageSize(25)).toBe(false);
    expect(isFollowupPageSize(30)).toBe(false);
    expect(isFollowupChannelFilter("email")).toBe(true);
    expect(isFollowupChannelFilter("other")).toBe(false);
  });

  it("returns consecutive pages when the range is small", () => {
    expect(pageNumbersWithEllipsis(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("inserts ellipsis around the current window on long ranges", () => {
    expect(pageNumbersWithEllipsis(1, 12)).toEqual([1, 2, "ellipsis", 12]);
    expect(pageNumbersWithEllipsis(6, 12)).toEqual([1, "ellipsis", 5, 6, 7, "ellipsis", 12]);
    expect(pageNumbersWithEllipsis(12, 12)).toEqual([1, "ellipsis", 11, 12]);
  });
});
