import { describe, expect, it } from "vitest";
import {
  buildKnowledgePack,
  buildPromptsPack,
  normalizeDocumentDoc,
  normalizeLibraryDoc,
  slugifyOrgForFilename,
} from "@/lib/ai/knowledge-pack-build";
import {
  AI_FEATURE_KEYS,
  parseKnowledgePack,
  parsePromptsPack,
  safeParseKnowledgePack,
} from "@/lib/ai/knowledge-pack-schema";

describe("knowledge pack schema", () => {
  it("builds and re-parses a valid org knowledge pack", () => {
    const pack = buildKnowledgePack({
      organizationId: "org_1",
      organizationName: "Stellix Soft LLC",
      libraries: [
        normalizeLibraryDoc("lib_company", {
          name: "Company fit — StellixSoft",
          scope: { type: "org" },
          libraryKind: "fit_check_global",
          allowedFeatures: ["content", "outreach", "fit_check"],
          documentCount: 31,
          chunkCount: 216,
        }),
      ],
      documents: [
        normalizeDocumentDoc("doc_1", {
          libraryId: "lib_company",
          title: "ICP",
          sourceType: "markdown",
          content: "# ICP\n\nEnterprise buyers.",
          knowledgeSection: "icp",
        })!,
      ],
      brands: [
        {
          id: "brand_1",
          name: "Stellix Soft",
          kind: "company",
          knowledgeLibraryIds: ["lib_company"],
          active: true,
        },
      ],
      profileKnowledgeLibraryIds: {
        profile_a: ["lib_company"],
        profile_empty: [],
      },
      fitCheckKnowledge: {
        globalEnabled: true,
        globalLibraryId: "lib_company",
        categories: {
          job_apply: { enabled: true, useGlobal: true },
          upwork: { enabled: true, useGlobal: true },
          rfp: { enabled: true, useGlobal: true },
          inbound: { enabled: true, useGlobal: true },
          cold_outbound: { enabled: true, useGlobal: true },
          other: { enabled: true, useGlobal: true },
        },
        retrievalBudget: { globalChunks: 4, categoryChunks: 2 },
      },
      embedding: { model: "text-embedding-3-small", provider: "openai" },
      exportedAt: "2026-09-08T00:00:00.000Z",
    });

    expect(pack.format).toBe("nova-knowledge-pack");
    expect(pack.counts).toEqual({
      libraries: 1,
      documents: 1,
      brands: 1,
      profilesWithLibraries: 1,
    });
    expect(pack.links.profileKnowledgeLibraryIds).toEqual({
      profile_a: ["lib_company"],
    });
    expect(parseKnowledgePack(JSON.parse(JSON.stringify(pack))).counts.documents).toBe(1);
  });

  it("rejects packs missing format", () => {
    const result = safeParseKnowledgePack({ version: 1, libraries: [] });
    expect(result.success).toBe(false);
  });
});

describe("prompts pack", () => {
  it("fills defaults and marks overrides", () => {
    const pack = buildPromptsPack({
      organizationId: "org_1",
      organizationName: "Stellix Soft LLC",
      storedByFeature: {
        content_draft_generate: {
          featureKey: "content_draft_generate",
          systemPrompt: "Custom system",
          // Must keep required placeholders or it falls back to default.
          userPromptTemplate:
            "Write.\n{{playbook}}\n{{charTarget}}\n{{format}}\n{{sourcePost}}\n{{knowledgePackContext}}",
          version: 3,
          updatedAt: "2026-09-08T00:00:00.000Z",
        },
      },
      exportedAt: "2026-09-08T00:00:00.000Z",
    });

    expect(pack.format).toBe("nova-prompts-pack");
    expect(pack.prompts).toHaveLength(AI_FEATURE_KEYS.length);
    expect(pack.counts.overrides).toBe(1);
    expect(pack.counts.defaults).toBe(AI_FEATURE_KEYS.length - 1);

    const draft = pack.prompts.find((p) => p.featureKey === "content_draft_generate");
    expect(draft?.source).toBe("override");
    expect(draft?.systemPrompt).toBe("Custom system");

    const other = pack.prompts.find((p) => p.featureKey === "dashboard_brief");
    expect(other?.source).toBe("default");

    expect(parsePromptsPack(JSON.parse(JSON.stringify(pack))).counts.prompts).toBe(
      AI_FEATURE_KEYS.length,
    );
  });

  it("treats stale templates as defaults", () => {
    const pack = buildPromptsPack({
      organizationId: "org_1",
      storedByFeature: {
        content_draft_generate: {
          featureKey: "content_draft_generate",
          systemPrompt: "Old",
          userPromptTemplate: "Missing required placeholders",
        },
      },
    });
    const draft = pack.prompts.find((p) => p.featureKey === "content_draft_generate");
    expect(draft?.source).toBe("default");
    expect(draft?.systemPrompt).not.toBe("Old");
  });
});

describe("slugifyOrgForFilename", () => {
  it("slugifies org names", () => {
    expect(slugifyOrgForFilename("Stellix Soft LLC")).toBe("stellix-soft-llc");
  });
});
