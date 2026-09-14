import { describe, expect, it } from "vitest";
import { betaPosterior, probVariantBeatsControl } from "@/lib/ai/eval/posterior";
import { projectOutreachFunnel } from "@/lib/ai/eval/projection";

describe("betaPosterior", () => {
  it("centers near observed rate with weak prior", () => {
    const p = betaPosterior(20, 1000);
    expect(p.mean).toBeGreaterThan(0.015);
    expect(p.mean).toBeLessThan(0.03);
    expect(p.ci80[0]).toBeLessThan(p.mean);
    expect(p.ci80[1]).toBeGreaterThan(p.mean);
  });

  it("gives high P(variant > control) for clear lift", () => {
    const control = betaPosterior(20, 1000);
    const variant = betaPosterior(50, 1000);
    const p = probVariantBeatsControl(variant, control, 2000);
    expect(p).toBeGreaterThan(0.9);
  });
});

describe("projectOutreachFunnel", () => {
  it("surfaces mailbox requirement for one deal", () => {
    const r = projectOutreachFunnel({ targetDeals: 1, horizonDays: 30 });
    expect(r.requiredLeads).toBeGreaterThan(100);
    expect(r.mailboxesForHorizon).toBeGreaterThanOrEqual(1);
  });
});
