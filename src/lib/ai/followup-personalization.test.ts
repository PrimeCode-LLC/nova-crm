import { describe, expect, it } from "vitest";
import {
  buildFollowupPersonalizationProfile,
  formatFollowupRoleGuidance,
} from "@/lib/ai/followup-personalization";

describe("buildFollowupPersonalizationProfile", () => {
  it("maps executive titles to short outcome-first guidance", () => {
    const profile = buildFollowupPersonalizationProfile({
      title: "CEO",
      seniority: "C-level",
    });
    expect(profile.roleFamily).toBe("executive");
    expect(profile.targetEmailWords).toContain("45-85");
    expect(profile.communicationStrategy.toLowerCase()).toContain("business outcome");
  });

  it("maps engineering titles to practitioner guidance", () => {
    const profile = buildFollowupPersonalizationProfile({
      title: "Senior Software Engineer",
    });
    expect(profile.roleFamily).toBe("technical_practitioner");
    expect(profile.emphasize).toContain("workflow");
  });
});

describe("formatFollowupRoleGuidance", () => {
  it("includes mandatory constraints for the prompt", () => {
    const profile = buildFollowupPersonalizationProfile({ title: "CTO" });
    const block = formatFollowupRoleGuidance(profile);
    expect(block).toContain("Role family: technical_executive");
    expect(block).toContain("Target length:");
    expect(block).toContain("Emphasize:");
    expect(block).toContain("Avoid:");
  });
});
