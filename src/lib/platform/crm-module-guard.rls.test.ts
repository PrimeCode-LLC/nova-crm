/**
 * QA 1.3 — CRM module permissions are enforced on the server (PERM-03).
 * Uses real users/{uid} documents; skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAdminDb } from "@/lib/db/document-access/admin";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { COLLECTIONS } from "@/lib/documents/collections";
import { crmModuleAllowedServer } from "@/lib/platform/guard-admin-feature";
import type { TenantApiContext } from "@/lib/platform/tenant-api-guard";
import type { OrgMemberRole } from "@/lib/types";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-13-modules";
const USERS: Record<string, string> = {
  "qa13-content": "content_team",
  "qa13-sales": "salesperson",
  "qa13-prospecting": "prospecting",
};

function ctx(uid: string, role: OrgMemberRole): TenantApiContext {
  return {
    session: { uid, email: `${uid}@nova.test`, organizationId: ORG, orgRole: role },
    adminAuth: null,
    role,
  } as unknown as TenantApiContext;
}

describe.skipIf(!runDb)("server-side CRM module permissions (QA 1.3)", () => {
  beforeAll(async () => {
    const db = getAdminDb()!;
    for (const [uid, roleId] of Object.entries(USERS)) {
      await db.collection(COLLECTIONS.users).doc(uid).set({
        roleId,
        isSuperAdmin: false,
        orgRole: "member",
        organizationId: ORG,
      });
    }
  });

  afterAll(async () => {
    try {
      const db = getAdminDb()!;
      for (const uid of Object.keys(USERS)) {
        await db.collection(COLLECTIONS.users).doc(uid).delete();
      }
    } finally {
      await disconnectPrisma();
    }
  });

  it("content team has no CRM module access (PERM-03)", async () => {
    const c = ctx("qa13-content", "member");
    for (const entity of ["lead", "account", "contact", "deal"] as const) {
      expect(await crmModuleAllowedServer(c, entity, ["view"])).toBe(false);
      expect(await crmModuleAllowedServer(c, entity, ["edit"])).toBe(false);
    }
  });

  it("salesperson can view/create/edit but not delete accounts, contacts, deals", async () => {
    const c = ctx("qa13-sales", "member");
    expect(await crmModuleAllowedServer(c, "lead", ["view"])).toBe(true);
    expect(await crmModuleAllowedServer(c, "lead", ["create", "edit"])).toBe(true);
    expect(await crmModuleAllowedServer(c, "account", ["edit"])).toBe(true);
    expect(await crmModuleAllowedServer(c, "account", ["delete"])).toBe(false);
    expect(await crmModuleAllowedServer(c, "deal", ["delete"])).toBe(false);
  });

  it("prospecting can create lead rows via the prospects module, but has no deals", async () => {
    const c = ctx("qa13-prospecting", "member");
    expect(await crmModuleAllowedServer(c, "lead", ["create"])).toBe(true);
    expect(await crmModuleAllowedServer(c, "deal", ["view"])).toBe(false);
  });

  it("org owners and admins always pass", async () => {
    expect(await crmModuleAllowedServer(ctx("qa13-content", "owner"), "deal", ["delete"])).toBe(true);
    expect(await crmModuleAllowedServer(ctx("qa13-content", "admin"), "lead", ["view"])).toBe(true);
  });
});
