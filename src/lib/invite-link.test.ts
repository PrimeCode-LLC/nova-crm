import { describe, expect, it } from "vitest";
import { withInviteJoinParams } from "./invite-link";

describe("withInviteJoinParams", () => {
  it("appends invite and join to a relative path", () => {
    expect(withInviteJoinParams("/dashboard", { invite: "a.b.c" })).toBe(
      "/dashboard?invite=a.b.c",
    );
    expect(withInviteJoinParams("/dashboard", { join: "tok" })).toBe(
      "/dashboard?join=tok",
    );
  });

  it("rejects unsafe absolute-looking next paths", () => {
    expect(withInviteJoinParams("//evil.com", { invite: "x" })).toBe(
      "/dashboard?invite=x",
    );
  });

  it("preserves existing path when safe", () => {
    expect(withInviteJoinParams("/leads", { invite: "t" })).toBe("/leads?invite=t");
  });
});
