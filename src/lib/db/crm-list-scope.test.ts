import { describe, expect, it } from "vitest";

import { resolveCrmListNarrowToMember } from "@/lib/db/crm-list-scope";

describe("resolveCrmListNarrowToMember", () => {
  it("always narrows members regardless of query param", () => {
    expect(resolveCrmListNarrowToMember("member", null)).toBe(true);
    expect(resolveCrmListNarrowToMember("member", "0")).toBe(true);
  });

  it("narrows admins only when narrow=1", () => {
    expect(resolveCrmListNarrowToMember("admin", null)).toBe(false);
    expect(resolveCrmListNarrowToMember("admin", "1")).toBe(true);
    expect(resolveCrmListNarrowToMember("owner", "1")).toBe(true);
  });
});
