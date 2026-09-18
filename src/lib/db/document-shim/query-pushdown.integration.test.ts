/**
 * Pushdown vs legacy Node-path equivalence (integration).
 * Requires Compose Postgres + DOCUMENT_STORE_INTEGRATION=true.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import {
  deleteDocument,
  queryDocuments,
  queryDocumentsLegacyForTests,
  setDocument,
} from "@/lib/db/document-shim/store";
import { resetDocumentQuerySingleFlightForTests } from "@/lib/db/document-shim/query-singleflight";

const runIntegration =
  process.env.DOCUMENT_STORE_INTEGRATION === "true" &&
  Boolean(process.env.DATABASE_URL?.trim()) &&
  isDatabaseConfigured();

describe.runIf(runIntegration)("queryDocuments pushdown equivalence (integration)", () => {
  const organizationId = `org-pushdown-${Date.now()}`;
  const otherOrg = `org-pushdown-other-${Date.now()}`;
  const noteA = `notes/pd-a-${Date.now()}`;
  const noteB = `notes/pd-b-${Date.now()}`;
  const noteNested = `notes/pd-nest-${Date.now()}/child`;
  const touchA = `touchpoints/pd-t-${Date.now()}`;
  const noteOther = `notes/pd-other-${Date.now()}`;
  const created: string[] = [];

  beforeAll(async () => {
    resetDocumentQuerySingleFlightForTests();
    const fixtures: Array<{ path: string; data: Record<string, unknown> }> = [
      {
        path: noteA,
        data: {
          organizationId,
          authorId: "user-a",
          leadOwnerId: "owner-1",
          leadOwnerManagerIds: ["mgr-1", "mgr-2"],
          createdAt: "2026-09-18T10:00:00.000Z",
          body: "a",
        },
      },
      {
        path: noteB,
        data: {
          organizationId,
          authorId: "user-b",
          leadOwnerId: "owner-2",
          leadOwnerManagerIds: ["mgr-2"],
          createdAt: "2026-09-18T11:00:00.000Z",
          body: "b",
        },
      },
      {
        path: noteNested,
        data: {
          organizationId,
          authorId: "user-a",
          createdAt: "2026-09-18T10:00:00.000Z",
          body: "nested",
        },
      },
      {
        path: touchA,
        data: {
          organizationId,
          actorId: "user-a",
          leadOwnerManagerIds: ["mgr-1"],
          occurredAt: "2026-09-18T12:00:00.000Z",
        },
      },
      {
        path: noteOther,
        data: {
          organizationId: otherOrg,
          authorId: "user-a",
          createdAt: "2026-09-18T10:00:00.000Z",
          body: "other-org",
        },
      },
    ];
    for (const f of fixtures) {
      await setDocument(f.path, f.data, false);
      created.push(f.path);
    }
  });

  afterAll(async () => {
    for (const path of created) {
      try {
        await deleteDocument(path);
      } catch {
        /* ignore */
      }
    }
    resetDocumentQuerySingleFlightForTests();
  });

  async function expectSame(spec: Parameters<typeof queryDocuments>[0]) {
    resetDocumentQuerySingleFlightForTests();
    const [pushed, legacy] = await Promise.all([
      queryDocuments(spec),
      queryDocumentsLegacyForTests(spec),
    ]);
    expect(pushed.map((d) => d.path).sort()).toEqual(
      legacy.map((d) => d.path).sort(),
    );
    return pushed;
  }

  it("matches on authorId equality + pathPrefix immediate children", async () => {
    const docs = await expectSame({
      collectionRoot: "notes",
      pathPrefix: "notes",
      organizationId,
      filters: [
        { field: "organizationId", op: "==", value: organizationId },
        { field: "authorId", op: "==", value: "user-a" },
      ],
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 2000,
    });
    expect(docs.every((d) => !d.path.endsWith("/child"))).toBe(true);
    expect(docs.some((d) => d.path === noteA)).toBe(true);
    expect(docs.some((d) => d.path === noteNested)).toBe(false);
  });

  it("matches on array-contains manager hierarchy", async () => {
    const docs = await expectSame({
      collectionRoot: "notes",
      pathPrefix: "notes",
      organizationId,
      filters: [
        { field: "organizationId", op: "==", value: organizationId },
        { field: "leadOwnerManagerIds", op: "array-contains", value: "mgr-1" },
      ],
      limit: 100,
    });
    expect(docs.some((d) => d.path === noteA)).toBe(true);
    expect(docs.some((d) => d.path === noteB)).toBe(false);
  });

  it("matches startAfter + limit (Node slice; no SQL take)", async () => {
    await expectSame({
      collectionRoot: "notes",
      pathPrefix: "notes",
      organizationId,
      filters: [{ field: "organizationId", op: "==", value: organizationId }],
      orderBy: { field: "createdAt", direction: "asc" },
      startAfter: [{ id: noteA.split("/")[1]! }],
      limit: 10,
    });
  });

  it("does not leak other-org documents", async () => {
    const docs = await expectSame({
      collectionRoot: "notes",
      pathPrefix: "notes",
      organizationId,
      filters: [
        { field: "organizationId", op: "==", value: organizationId },
        { field: "authorId", op: "==", value: "user-a" },
      ],
    });
    expect(
      docs.every((d) => {
        const org = d.organizationId ?? d.payload.organizationId;
        return org === organizationId;
      }),
    ).toBe(true);
    expect(docs.some((d) => d.path === noteOther)).toBe(false);
  });

  it("matches touchpoints actorId + occurredAt order (order stays in Node)", async () => {
    const docs = await expectSame({
      collectionRoot: "touchpoints",
      pathPrefix: "touchpoints",
      organizationId,
      filters: [
        { field: "organizationId", op: "==", value: organizationId },
        { field: "actorId", op: "==", value: "user-a" },
      ],
      orderBy: { field: "occurredAt", direction: "desc" },
      limit: 2000,
    });
    expect(docs.some((d) => d.path === touchA)).toBe(true);
  });
});
