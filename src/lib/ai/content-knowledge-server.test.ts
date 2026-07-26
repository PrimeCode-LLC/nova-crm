import { describe, expect, it } from "vitest";
import {
  CONTENT_KNOWLEDGE_SECTIONS,
  CONTENT_KNOWLEDGE_SECTIONS_WITH_INTERNAL,
  formatContentRagChunkForPrompt,
  formatKnowledgeLibrariesForPrompt,
} from "@/lib/ai/content-knowledge-server";

describe("content-knowledge-server helpers", () => {
  it("includes other in the internal content section list", () => {
    expect(CONTENT_KNOWLEDGE_SECTIONS).not.toContain("other");
    expect(CONTENT_KNOWLEDGE_SECTIONS_WITH_INTERNAL).toEqual([
      ...CONTENT_KNOWLEDGE_SECTIONS,
      "other",
    ]);
  });

  it("labels internal Capture chunks for public-safe prompts", () => {
    expect(
      formatContentRagChunkForPrompt(
        {
          title: "Win story",
          content: "secret deal notes",
          score: 1,
          libraryId: "lib1",
          documentId: "doc1",
          knowledgeSection: "other",
        },
        true,
      ),
    ).toEqual({
      title: "Win story (internal context — do not quote as public proof)",
      content: "secret deal notes",
    });
  });

  it("leaves public sections unlabeled", () => {
    expect(
      formatContentRagChunkForPrompt(
        {
          title: "Case study",
          content: "shipped in 6 weeks",
          score: 1,
          libraryId: "lib1",
          documentId: "doc1",
          knowledgeSection: "case_studies",
        },
        true,
      ),
    ).toEqual({
      title: "Case study",
      content: "shipped in 6 weeks",
    });
  });

  it("formats knowledge pack intros for content prompts", () => {
    expect(formatKnowledgeLibrariesForPrompt([])).toBe("No knowledge packs linked.");
    expect(
      formatKnowledgeLibrariesForPrompt([
        {
          id: "1",
          name: "Nova",
          description:
            "Stellix Soft sales CRM for us and future clients. Solves pipeline and outreach.",
        },
        { id: "2", name: "Services" },
      ]),
    ).toBe(
      [
        "- Nova: Stellix Soft sales CRM for us and future clients. Solves pipeline and outreach.",
        "- Services: (no intro set — treat as a generic knowledge pack)",
      ].join("\n"),
    );
  });
});
