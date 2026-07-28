import { describe, expect, it } from "vitest";
import {
  resolveDefaultScheduleMailboxId,
  resolveDefaultScheduleMailboxPool,
} from "@/lib/email/last-used-mailbox-prefs";

describe("resolveDefaultScheduleMailboxId", () => {
  it("prefers last used when still available", () => {
    expect(
      resolveDefaultScheduleMailboxId({
        mailboxIds: ["a", "b", "c"],
        lastUsedId: "b",
        activeMailboxId: "a",
      }),
    ).toBe("b");
  });

  it("falls back to active inbox when last used is gone", () => {
    expect(
      resolveDefaultScheduleMailboxId({
        mailboxIds: ["a", "c"],
        lastUsedId: "b",
        activeMailboxId: "c",
      }),
    ).toBe("c");
  });

  it("falls back to first mailbox", () => {
    expect(
      resolveDefaultScheduleMailboxId({
        mailboxIds: ["a", "c"],
        lastUsedId: "b",
        activeMailboxId: "__all_mailboxes__",
      }),
    ).toBe("a");
  });
});

describe("resolveDefaultScheduleMailboxPool", () => {
  it("restores last bulk pool when still available", () => {
    expect(
      resolveDefaultScheduleMailboxPool({
        mailboxIds: ["a", "b", "c"],
        lastPoolIds: ["c", "b"],
      }),
    ).toEqual(["c", "b"]);
  });

  it("defaults to all when no pool saved", () => {
    expect(
      resolveDefaultScheduleMailboxPool({
        mailboxIds: ["a", "b"],
      }),
    ).toEqual(["a", "b"]);
  });

  it("drops removed mailboxes from the saved pool", () => {
    expect(
      resolveDefaultScheduleMailboxPool({
        mailboxIds: ["a", "c"],
        lastPoolIds: ["b", "c"],
      }),
    ).toEqual(["c"]);
  });
});
