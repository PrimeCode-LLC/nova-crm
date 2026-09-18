import { describe, expect, it } from "vitest";
import {
  buildPayloadFilterWhere,
  canPushDownFilter,
  canPushDownOrderBy,
  normalizePushdownInstant,
  planQueryPushdown,
  querySpecCacheKey,
} from "@/lib/db/document-shim/query-pushdown";
import { Timestamp } from "@/lib/db/document-shim/timestamp";

describe("query-pushdown capability checks", () => {
  it("pushes allowlisted string equality", () => {
    expect(canPushDownFilter({ field: "actorId", op: "==", value: "u1" })).toBe(true);
    expect(canPushDownFilter({ field: "leadId", op: "==", value: "l1" })).toBe(true);
  });

  it("rejects unknown / nested / non-scalar equality", () => {
    expect(canPushDownFilter({ field: "unknownField", op: "==", value: "x" })).toBe(false);
    expect(canPushDownFilter({ field: "actor.id", op: "==", value: "x" })).toBe(false);
    expect(
      canPushDownFilter({ field: "actorId", op: "==", value: { nested: true } }),
    ).toBe(false);
  });

  it("never pushes organizationId as a lone JSON equals", () => {
    expect(
      canPushDownFilter({ field: "organizationId", op: "==", value: "org-1" }),
    ).toBe(false);
  });

  it("pushes array-contains for manager hierarchy fields", () => {
    expect(
      canPushDownFilter({
        field: "leadOwnerManagerIds",
        op: "array-contains",
        value: "mgr-1",
      }),
    ).toBe(true);
    expect(
      canPushDownFilter({
        field: "randomArray",
        op: "array-contains",
        value: "x",
      }),
    ).toBe(false);
  });

  it("pushes in for allowlisted scalars", () => {
    expect(
      canPushDownFilter({ field: "status", op: "in", value: ["active", "paused"] }),
    ).toBe(true);
    expect(canPushDownFilter({ field: "status", op: "in", value: [] })).toBe(false);
  });

  it("pushes ISO range on *At fields; normalizes Timestamp filter values", () => {
    const ts = Timestamp.fromDate(new Date("2026-09-18T12:00:00.000Z"));
    expect(canPushDownFilter({ field: "dueAt", op: "<=", value: ts })).toBe(true);
    expect(normalizePushdownInstant(ts)).toBe("2026-09-18T12:00:00.000Z");
    expect(canPushDownFilter({ field: "title", op: "<=", value: "a" })).toBe(false);
  });

  it("only pushes orderBy for table columns createdAt/updatedAt", () => {
    expect(canPushDownOrderBy({ field: "createdAt", direction: "desc" })).toBe(true);
    expect(canPushDownOrderBy({ field: "updatedAt", direction: "asc" })).toBe(true);
    expect(canPushDownOrderBy({ field: "occurredAt", direction: "desc" })).toBe(false);
  });

  it("rejects numeric equality (Node String coercion ≠ SQL jsonb equality)", () => {
    expect(canPushDownFilter({ field: "leadId", op: "==", value: 123 })).toBe(false);
    expect(
      canPushDownFilter({ field: "status", op: "in", value: [1, 2] }),
    ).toBe(false);
    expect(canPushDownFilter({ field: "leadId", op: "==", value: "123" })).toBe(true);
  });

  it("never pushes != (SQL NULL / missing-key semantics diverge)", () => {
    expect(canPushDownFilter({ field: "status", op: "!=", value: "x" })).toBe(false);
  });

  it("range clauses exclude JSON null", () => {
    const where = buildPayloadFilterWhere({
      field: "completedAt",
      op: "<",
      value: "2026-01-01T00:00:00.000Z",
    });
    expect(where).toEqual({
      AND: [
        { NOT: { payload: { path: ["completedAt"], equals: expect.anything() } } },
        { payload: { path: ["completedAt"], lt: "2026-01-01T00:00:00.000Z" } },
      ],
    });
    // Explicit JSON null exclusion (Prisma.JsonNull) — not JS null.
    expect(JSON.stringify(where)).toContain("completedAt");
  });
});

describe("planQueryPushdown", () => {
  it("pushes member-scope equality; keeps limit in Node when pathPrefix is set", () => {
    const plan = planQueryPushdown({
      collectionRoot: "notes",
      pathPrefix: "notes",
      organizationId: "org-1",
      filters: [
        { field: "organizationId", op: "==", value: "org-1" },
        { field: "authorId", op: "==", value: "u1" },
      ],
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 2000,
    });
    expect(plan.pushedFilters.map((f) => f.field)).toEqual(["authorId"]);
    expect(plan.residualFilters).toEqual([]);
    expect(plan.pushOrderBy).toBe(true);
    // pathPrefix → Node immediate-child filter; take must stay in Node.
    expect(plan.pushLimit).toBe(false);
  });

  it("pushes limit when there is no pathPrefix and orderBy is a column", () => {
    const plan = planQueryPushdown({
      collectionRoot: "followups",
      filters: [{ field: "leadId", op: "==", value: "l1" }],
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 50,
    });
    expect(plan.pushOrderBy).toBe(true);
    expect(plan.pushLimit).toBe(true);
  });

  it("does not push limit when orderBy is a payload-only field", () => {
    const plan = planQueryPushdown({
      collectionRoot: "activityRecords",
      pathPrefix: "activityRecords",
      filters: [{ field: "userId", op: "==", value: "u1" }],
      orderBy: { field: "occurredAt", direction: "desc" },
      limit: 200,
    });
    expect(plan.pushOrderBy).toBe(false);
    expect(plan.pushLimit).toBe(false);
    expect(plan.pushedFilters.map((f) => f.field)).toEqual(["userId"]);
  });

  it("does not push take when startAfter is present", () => {
    const plan = planQueryPushdown({
      collectionRoot: "followups",
      filters: [{ field: "leadId", op: "==", value: "l1" }],
      limit: 50,
      startAfter: [{ id: "f-1" }],
    });
    expect(plan.pushLimit).toBe(false);
    expect(plan.reasons.some((r) => r.includes("startAfter"))).toBe(true);
  });

  it("keeps collectionGroup on the Node path", () => {
    const plan = planQueryPushdown({
      collectionGroup: "members",
      filters: [{ field: "role", op: "==", value: "owner" }],
      limit: 10,
    });
    expect(plan.pushedFilters).toEqual([]);
    expect(plan.pushLimit).toBe(false);
    expect(plan.pushOrderBy).toBe(false);
  });

  it("leaves unknown filters residual so take is not pushed", () => {
    const plan = planQueryPushdown({
      collectionRoot: "followups",
      filters: [
        { field: "leadId", op: "==", value: "l1" },
        { field: "customBlob", op: "==", value: "x" },
      ],
      limit: 10,
    });
    expect(plan.pushedFilters.map((f) => f.field)).toEqual(["leadId"]);
    expect(plan.residualFilters.map((f) => f.field)).toEqual(["customBlob"]);
    expect(plan.pushLimit).toBe(false);
  });

  it("builds a stable cache key independent of filter order", () => {
    const a = querySpecCacheKey({
      collectionRoot: "notes",
      filters: [
        { field: "authorId", op: "==", value: "u1" },
        { field: "organizationId", op: "==", value: "org" },
      ],
      limit: 10,
    });
    const b = querySpecCacheKey({
      collectionRoot: "notes",
      filters: [
        { field: "organizationId", op: "==", value: "org" },
        { field: "authorId", op: "==", value: "u1" },
      ],
      limit: 10,
    });
    expect(a).toBe(b);
  });
});
