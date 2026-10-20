/**
 * QA 1.1 — organization writes (document store) must reach the Postgres row that
 * getOrganizationServer / tenant guards read. Regression for PLAT-03, CFG-03,
 * TEAM-05, TEAM-07. Skips when DATABASE_URL is unset.
 */

import { afterAll, describe, expect, it } from "vitest";

import { getAdminDb } from "@/lib/db/document-access/admin";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  bumpOrganizationSeatsServer,
  createOrganizationServer,
  getOrganizationServer,
  updateOrganizationServer,
} from "@/lib/platform/organizations-server";
import {
  setOrganizationOpenJoinHashServer,
  verifyOpenJoinTokenServer,
} from "@/lib/platform/open-join-server";

const runDb = isDatabaseConfigured();

describe.skipIf(!runDb)("organization mirror after write (QA 1.1)", () => {
  let orgId = "";

  afterAll(async () => {
    try {
      if (orgId) {
        await getAdminDb()?.collection(COLLECTIONS.organizations).doc(orgId).delete();
        await withRlsBypass(async (tx) => {
          await tx.organization.deleteMany({ where: { id: orgId } });
        });
      }
    } finally {
      await disconnectPrisma();
    }
  });

  it("status, plan, seats cap and settings written by the platform are read back", async () => {
    const created = await createOrganizationServer({
      name: `QA Mirror Org ${Date.now()}`,
      ownerUid: "qa-mirror-owner",
      ownerEmail: "qa-mirror-owner@nova.test",
    });
    if ("error" in created) throw new Error(created.error);
    orgId = created.id;

    const res = await updateOrganizationServer(orgId, {
      name: "QA Mirror Org Renamed",
      status: "suspended",
      planId: "pro",
      maxUsers: 10,
      settings: { timezone: "Asia/Karachi" },
    });
    expect(res).toEqual({ ok: true });

    const org = await getOrganizationServer(orgId);
    expect(org?.name).toBe("QA Mirror Org Renamed");
    expect(org?.status).toBe("suspended");
    expect(org?.planId).toBe("pro");
    expect(org?.maxUsers).toBe(10);
    expect(org?.settings?.timezone).toBe("Asia/Karachi");
  });

  it("seat count changes are read back", async () => {
    const before = (await getOrganizationServer(orgId))?.seatsUsed ?? 0;
    const bumped = await bumpOrganizationSeatsServer(orgId, 1);
    expect(bumped.ok).toBe(true);
    expect((await getOrganizationServer(orgId))?.seatsUsed).toBe(before + 1);
  });

  it("a freshly created join link verifies", async () => {
    const { hashOpenJoinSecret, packOpenJoinToken } = await import(
      "@/lib/platform/open-join-server"
    );
    const secret = "qa-join-secret-123456";
    const set = await setOrganizationOpenJoinHashServer(orgId, hashOpenJoinSecret(secret));
    expect(set).toEqual({ ok: true });
    const verified = await verifyOpenJoinTokenServer(packOpenJoinToken(orgId, secret));
    expect(verified).toEqual({ orgId });
  });
});
