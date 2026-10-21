import { describe, expect, it } from "vitest";

import { isDefinitiveRejection } from "@/components/providers/clerk-complete-membership";

describe("invite token retry policy (QA 3.4 / ROB-04)", () => {
  it("drops the token on definitive rejections only", () => {
    for (const status of [400, 403, 404, 409, 410]) expect(isDefinitiveRejection(status)).toBe(true);
    for (const status of [401, 408, 429, 500, 502, 503]) expect(isDefinitiveRejection(status)).toBe(false);
  });
});
