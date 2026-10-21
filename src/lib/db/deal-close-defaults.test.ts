import { describe, expect, it } from "vitest";

import { applyDealCloseDefaults } from "@/lib/db/crm-write-postgres";

const now = "2026-10-21T12:00:00.000Z";

describe("deal close defaults (QA 3.3 / CRM-04)", () => {
  it("won → 100% with wonAt; lost → 0% with lostAt", () => {
    const won = { stage: "won", probability: 25, lostAt: "x" } as Record<string, unknown>;
    applyDealCloseDefaults(won, { stage: "won" }, now);
    expect(won).toMatchObject({ probability: 100, wonAt: now });
    expect(won).not.toHaveProperty("lostAt");

    const lost = { stage: "lost", probability: 70 } as Record<string, unknown>;
    applyDealCloseDefaults(lost, { stage: "lost" }, now);
    expect(lost).toMatchObject({ probability: 0, lostAt: now });
  });

  it("keeps an explicit probability and an existing wonAt", () => {
    const d = { stage: "won", probability: 90, wonAt: "2026-01-01T00:00:00.000Z" } as Record<string, unknown>;
    applyDealCloseDefaults(d, { stage: "won", probability: 90 }, now);
    expect(d).toMatchObject({ probability: 90, wonAt: "2026-01-01T00:00:00.000Z" });
  });

  it("leaves open deals and writes that do not touch the stage alone", () => {
    const open = { stage: "proposal", probability: 50 } as Record<string, unknown>;
    applyDealCloseDefaults(open, { stage: "proposal" }, now);
    expect(open).toEqual({ stage: "proposal", probability: 50 });
    const renamed = { stage: "won", probability: 25, name: "x" } as Record<string, unknown>;
    applyDealCloseDefaults(renamed, { name: "x" }, now);
    expect(renamed.probability).toBe(25);
  });
});
