import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "@/lib/db/document-shim/timestamp";

const createdAt = "2026-10-22T21:00:24.065Z";

vi.mock("@/lib/platform/guard-admin-feature", () => ({
  guardAdminFeature: vi.fn(async () => ({
    ok: true,
    ctx: { session: { uid: "u-1", organizationId: "org-1" } },
  })),
}));

vi.mock("@/lib/db/document-access/admin", () => {
  const doc = {
    id: "imp-1",
    // The document shim hands back revived Timestamps for ISO `*At` fields.
    data: () => ({ organizationId: "org-1", uploaderId: "u-1", createdAt: Timestamp.fromDate(new Date(createdAt)), counts: { total: 3 } }),
  };
  const chain = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    get: async () => ({ docs: [doc] }),
  };
  return { getAdminDb: () => ({ collection: () => chain }) };
});

import { GET } from "./route";

describe("GET /api/org/imports", () => {
  it("returns createdAt as an ISO string so the recent list shows a real date (ROB-04)", async () => {
    const json = (await (await GET()).json()) as { jobs: { createdAt: unknown }[] };
    expect(json.jobs[0]!.createdAt).toBe(createdAt);
  });
});
