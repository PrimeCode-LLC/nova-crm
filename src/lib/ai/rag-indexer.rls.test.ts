/**
 * QA 2.7 — a provider failure while indexing returns a readable error and marks
 * the document index_failed instead of throwing a blank 500 (AI-02, AI-05, AI-06).
 * Real document store; provider, key and settings are mocked. Skips without DATABASE_URL.
 */

import { APICallError } from "ai";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  embedMany: vi.fn(async () => {
    throw new APICallError({
      message: "Incorrect API key provided",
      url: "https://api.openai.com/v1/embeddings",
      requestBodyValues: {},
      statusCode: 401,
    });
  }),
}));
vi.mock("@/lib/ai/ai-secrets-server", () => ({ getAiProviderKeyServer: vi.fn(async () => "sk-test-invalid") }));
vi.mock("@/lib/ai/ai-settings-server", () => ({
  getOrganizationAiSettingsServer: vi.fn(async () => ({ embeddingProvider: "openai", embeddingModel: "text-embedding-3-small" })),
}));
vi.mock("@/lib/ai/usage-logger", () => ({ recordAiUsage: vi.fn(async () => undefined) }));

import { getAdminDb } from "@/lib/db/document-access/admin";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { indexAiDocumentServer } from "@/lib/ai/rag-indexer";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-27-rag";

describe.skipIf(!runDb)("RAG indexing provider failure (QA 2.7)", () => {
  afterAll(async () => {
    try {
      await withRlsBypass((tx) =>
        tx.pgDocument.deleteMany({ where: { path: { startsWith: `organizations/${ORG}/` } } }),
      );
    } finally {
      await disconnectPrisma();
    }
  });

  it("returns the provider message and marks the document index_failed", async () => {
    const ref = getAdminDb()!
      .collection(COLLECTIONS.organizations).doc(ORG)
      .collection(ORG_SUBCOLLECTIONS.aiDocuments).doc("qa27-doc");
    await ref.set({ organizationId: ORG, libraryId: "lib1", title: "Doc", content: "Some knowledge text." });

    const result = await indexAiDocumentServer({ organizationId: ORG, documentId: "qa27-doc", userId: "u1" });
    expect(result).toEqual({ error: expect.stringMatching(/rejected the API key/) });
    const data = (await ref.get()).data()!;
    expect(data.indexStatus).toBe("index_failed");
    expect(String(data.indexError)).toMatch(/rejected the API key/);
  });
});
