import { describe, expect, it } from "vitest";
import {
  captureDisplayTitle,
  captureFieldLabel,
  formatCaptureFieldsForPrompt,
  knowledgeSectionForCapture,
  normalizeCaptureType,
} from "@/lib/content-calendar/capture-types";

describe("capture-types", () => {
  it("defaults unknown capture types to win", () => {
    expect(normalizeCaptureType(undefined)).toBe("win");
    expect(normalizeCaptureType("feature")).toBe("feature");
    expect(normalizeCaptureType("nope")).toBe("win");
  });

  it("maps public-safe types to the right knowledge sections", () => {
    expect(knowledgeSectionForCapture("win", true)).toBe("case_studies");
    expect(knowledgeSectionForCapture("feature", true)).toBe("services");
    expect(knowledgeSectionForCapture("icp", true)).toBe("icp");
    expect(knowledgeSectionForCapture("voice", true)).toBe("content_voice");
  });

  it("puts internal captures in other regardless of type", () => {
    expect(knowledgeSectionForCapture("feature", false)).toBe("other");
    expect(knowledgeSectionForCapture("voice", false)).toBe("other");
  });

  it("formats typed field blocks for prompts", () => {
    expect(
      formatCaptureFieldsForPrompt("feature", {
        problem: "Email rerouting",
        solution: "Auto-forwards warm inbound",
        outcome: "SDRs",
        notes: "",
      }),
    ).toContain("Feature name: Email rerouting");
    expect(
      formatCaptureFieldsForPrompt("feature", {
        problem: "Email rerouting",
        solution: "Auto-forwards warm inbound",
      }),
    ).toContain("Extra notes: (empty)");
  });

  it("uses type-aware field labels", () => {
    expect(captureFieldLabel("icp", "problem")).toBe("Who");
    expect(captureFieldLabel("voice", "solution")).toBe("Your take");
  });

  it("prefers normalized titles for display", () => {
    expect(
      captureDisplayTitle({
        normalizedTitle: "Reply lag case study",
        problem: "long problem text",
      }),
    ).toBe("Reply lag case study");
    expect(captureDisplayTitle({ problem: "a".repeat(100) }).length).toBe(80);
  });
});
