import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredDoc } from "@/lib/db/document-shim/store";

const guardTenantApi = vi.hoisted(() => vi.fn());

vi.mock("@/lib/platform/tenant-api-guard", () => ({
  guardTenantApi,
}));

vi.mock("@/lib/db/document-shim/store", () => ({
  getDocument: vi.fn(),
  queryDocuments: vi.fn(),
  setDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

import { GET, PATCH } from "./route";
import { getDocument, queryDocuments, updateDocument } from "@/lib/db/document-shim/store";

function stored(path: string, payload: Record<string, unknown>): StoredDoc {
  return {
    path,
    organizationId: "org-1",
    collectionRoot: path.split("/")[0] ?? path,
    payload: { organizationId: "org-1", ...payload },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function asSalesperson() {
  guardTenantApi.mockResolvedValue({
    ok: true,
    ctx: {
      session: { uid: "sales-1", organizationId: "org-1", email: "s@nova.test" },
      adminAuth: null,
      role: "member",
    },
  });
}

describe("/api/org/workspace-documents member scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asSalesperson();
    vi.mocked(getDocument).mockImplementation(async (path: string) => {
      if (path === "users/sales-1") return stored(path, { roleId: "salesperson" });
      return null;
    });
    vi.mocked(queryDocuments).mockImplementation(async (spec) => {
      const owner = spec.filters.find((f) => f.field === "ownerId" && f.op === "==");
      const managers = spec.filters.find(
        (f) => f.field === "ownerManagerIds" && f.op === "array-contains",
      );
      if (owner?.value === "sales-1") {
        return [stored("followups/own", { ownerId: "sales-1", title: "mine" })];
      }
      if (managers?.value === "sales-1") {
        return [
          stored("followups/managed", {
            ownerId: "report-1",
            ownerManagerIds: ["sales-1"],
            title: "report",
          }),
        ];
      }
      return [stored("followups/peer", { ownerId: "other", title: "secret" })];
    });
  });

  it("returns only own and managed follow-ups when a salesperson lists without filters", async () => {
    const response = await GET(
      new Request("https://nova.test/api/org/workspace-documents?collection=followups"),
    );
    const json = (await response.json()) as { docs: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(json.docs.map((doc) => doc.id).sort()).toEqual(["managed", "own"]);
    expect(queryDocuments).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(queryDocuments).mock.calls) {
      const filters = call[0].filters;
      const scoped = filters.some(
        (f) =>
          (f.field === "ownerId" && f.value === "sales-1") ||
          (f.field === "ownerManagerIds" && f.value === "sales-1"),
      );
      expect(scoped).toBe(true);
    }
  });

  it("rejects a salesperson patch of a peer follow-up", async () => {
    vi.mocked(getDocument).mockImplementation(async (path: string) => {
      if (path === "users/sales-1") return stored(path, { roleId: "salesperson" });
      if (path === "followups/peer") return stored(path, { ownerId: "other", title: "secret" });
      return null;
    });

    const response = await PATCH(
      new Request("https://nova.test/api/org/workspace-documents", {
        method: "PATCH",
        body: JSON.stringify({ path: "followups/peer", patch: { title: "hijack" } }),
      }),
    );

    expect(response.status).toBe(403);
    expect(updateDocument).not.toHaveBeenCalled();
  });
});
