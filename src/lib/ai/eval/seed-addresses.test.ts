import { describe, expect, it } from "vitest";
import {
  buildSeedProspectStubs,
  isSeedRecipient,
  normalizeSeedEmails,
  seedMetaForRecipient,
} from "@/lib/ai/eval/seed-addresses";
import type { OrganizationAiSettings } from "@/lib/ai/types";

const settings = {
  seedAddresses: [" Alpha@Seed.io ", "beta@seed.io", "not-an-email"],
} as OrganizationAiSettings;

describe("seed-addresses", () => {
  it("normalizes and filters seed emails", () => {
    expect(normalizeSeedEmails(settings)).toEqual(["alpha@seed.io", "beta@seed.io"]);
  });

  it("builds stubs and matches recipients", () => {
    const stubs = buildSeedProspectStubs(settings);
    expect(stubs).toHaveLength(2);
    expect(stubs[0]).toMatchObject({ to: "alpha@seed.io", isSeed: true });
    expect(isSeedRecipient(settings, "ALPHA@seed.io")).toBe(true);
    expect(isSeedRecipient(settings, "other@x.com")).toBe(false);
  });

  it("builds seed meta for sent events", () => {
    expect(seedMetaForRecipient("Alpha@Seed.io")).toEqual({
      seedAddress: true,
      seedTo: "alpha@seed.io",
      seedPlacement: "unknown",
    });
  });
});
