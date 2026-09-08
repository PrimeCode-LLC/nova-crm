import { describe, expect, it } from "vitest";
import { buildKnowledgePack, buildPromptsPack } from "@/lib/ai/knowledge-pack-build";
import { previewKnowledgePack, previewPromptsPack } from "@/lib/ai/knowledge-pack-preview";

describe("knowledge pack import preview", () => {
  it("previews a built knowledge pack for a target org", () => {
    const pack = buildKnowledgePack({
      organizationId: "source_org",
      organizationName: "Source",
      libraries: [
        {
          id: "lib1",
          name: "Company",
          scope: { type: "org" },
        },
      ],
      documents: [
        {
          id: "doc1",
          libraryId: "lib1",
          title: "ICP",
          sourceType: "markdown",
          content: "Hello",
        },
      ],
      brands: [
        {
          id: "brand1",
          name: "Brand",
          kind: "company",
          knowledgeLibraryIds: ["lib1"],
        },
      ],
      profileKnowledgeLibraryIds: {},
    });

    const preview = previewKnowledgePack({
      pack,
      targetOrganizationId: "target_org",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.targetOrganizationId).toBe("target_org");
    expect(preview.willUpsert.documents).toBe(1);
    expect(preview.sourceOrganizationId).toBe("source_org");
  });

  it("rejects invalid knowledge packs", () => {
    const preview = previewKnowledgePack({
      pack: { format: "nope" },
      targetOrganizationId: "target_org",
    });
    expect(preview.ok).toBe(false);
  });
});

describe("prompts pack import preview", () => {
  it("previews prompts pack", () => {
    const pack = buildPromptsPack({
      organizationId: "source_org",
      storedByFeature: {},
    });
    const preview = previewPromptsPack({ pack });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.counts.prompts).toBe(pack.prompts.length);
  });
});
