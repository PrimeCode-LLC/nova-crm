import { describe, expect, it } from "vitest";

import { resolveOwnerDisplayName, withMemberDisplayName } from "@/lib/member-display-name";

const labels = { user_abc: "Ch. Zain Abdullah", user_x: "Olive" };

describe("member display-name fallback (QA 2.2)", () => {
  it("replaces a uid-as-name with the member label", () => {
    expect(withMemberDisplayName({ id: "user_abc", displayName: "user_abc" }, labels).displayName).toBe(
      "Ch. Zain Abdullah",
    );
    expect(withMemberDisplayName({ id: "user_abc", displayName: "" }, labels).displayName).toBe(
      "Ch. Zain Abdullah",
    );
  });

  it("keeps a real name and the same object", () => {
    const u = { id: "user_x", displayName: "Olive Teammate" };
    expect(withMemberDisplayName(u, labels)).toBe(u);
  });

  it("resolves owner names without returning the raw uid when a label exists", () => {
    const users = [{ id: "user_abc", displayName: "user_abc" }];
    expect(resolveOwnerDisplayName("user_abc", users, labels)).toBe("Ch. Zain Abdullah");
    expect(resolveOwnerDisplayName("user_x", [], labels)).toBe("Olive");
    expect(resolveOwnerDisplayName("", users, labels)).toBeUndefined();
  });
});
