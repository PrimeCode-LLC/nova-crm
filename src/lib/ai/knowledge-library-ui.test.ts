import { describe, expect, it } from "vitest";
import {
  displayKnowledgeLibraryName,
  defaultAllowedFeaturesForLibraryType,
  libraryAllowsFeature,
  resolveAllowedFeatures,
  resolveKnowledgeLibraryType,
} from "@/lib/ai/knowledge-library-ui";
import type { AiLibraryAllowedFeature } from "@/lib/ai/types";

describe("knowledge-library-ui", () => {
  it("maps legacy Fit Check global names to company", () => {
    expect(
      resolveKnowledgeLibraryType({
        name: "Sales knowledge, Global (company)",
        libraryKind: "fit_check_global",
      }),
    ).toBe("company");
    expect(
      displayKnowledgeLibraryName({
        name: "Sales knowledge, Global (company)",
        libraryKind: "fit_check_global",
      }),
    ).toBe("Company knowledge");
  });

  it("maps category libraries to channel packs", () => {
    expect(
      displayKnowledgeLibraryName({
        name: "Sales knowledge, Upwork",
        libraryKind: "fit_check_category",
        fitCategory: "upwork",
      }),
    ).toBe("Channel · Upwork");
  });

  it("defaults company libs to all features with content first", () => {
    const features = defaultAllowedFeaturesForLibraryType("company");
    expect(features[0]).toBe("content");
    expect(features).toContain("fit_check");
    expect(features).toContain("outreach");
  });

  it("defaults brand packs to content only", () => {
    expect(defaultAllowedFeaturesForLibraryType("brand")).toEqual(["content"]);
  });

  it("uses stored allowedFeatures when present", () => {
    const lib = {
      libraryKind: "fit_check_global",
      allowedFeatures: ["fit_check", "outreach"] as AiLibraryAllowedFeature[],
    };
    expect(resolveAllowedFeatures(lib)).toEqual(["fit_check", "outreach"]);
    expect(libraryAllowsFeature(lib, "content")).toBe(false);
    expect(libraryAllowsFeature(lib, "fit_check")).toBe(true);
  });

  it("falls back to type defaults when allowedFeatures missing", () => {
    expect(
      resolveAllowedFeatures({
        libraryKind: "content_brand",
        scope: { type: "content_brand", brandId: "b1" },
      }),
    ).toEqual(["content"]);
  });
});
