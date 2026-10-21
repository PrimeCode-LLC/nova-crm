/**
 * QA 2.2 — the server roster shows the member's name, not the raw uid, for
 * users/{uid} docs written without a name (PROS-01, SCH-03).
 * Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAdminDb } from "@/lib/db/document-access/admin";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS } from "@/lib/documents/collections";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { upsertMemberServer } from "@/lib/platform/members-server";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-22-names";
const UID = "user_qa22_nameless";
const NAMED = "user_qa22_named";
const now = "2026-10-21T00:00:00.000Z";

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.member.deleteMany({ where: { organizationId: ORG } });
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
  for (const uid of [UID, NAMED]) {
    await getAdminDb()!.collection(COLLECTIONS.users).doc(uid).delete().catch(() => undefined);
  }
}

describe.skipIf(!runDb)("server roster name fallback (QA 2.2)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 2.2", slug: "qa-22-names", status: "active", planId: "free",
          seatsUsed: 2, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    const db = getAdminDb()!;
    // Shape written by onboarding before the fix: no displayName / email.
    await db.collection(COLLECTIONS.users).doc(UID).set({ organizationId: ORG, orgRole: "owner", roleId: "director" });
    await db.collection(COLLECTIONS.users).doc(NAMED).set({
      organizationId: ORG, orgRole: "member", displayName: "Kept Name", email: "kept@nova.test",
    });
    await upsertMemberServer({
      organizationId: ORG, uid: UID, email: "zain@nova.test", displayName: "Ch. Zain Abdullah",
      role: "owner", status: "active", invitedByUid: "owner-bootstrap",
    });
    await upsertMemberServer({
      organizationId: ORG, uid: NAMED, email: "other@nova.test", displayName: "Member Label",
      role: "member", status: "active", invitedByUid: UID,
    });
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  });

  it("fills a missing name/email from the member record and keeps real names", async () => {
    const users = await listOrgUsersServer(ORG);
    expect(users.find((u) => u.id === UID)).toMatchObject({
      displayName: "Ch. Zain Abdullah",
      email: "zain@nova.test",
    });
    expect(users.find((u) => u.id === NAMED)).toMatchObject({ displayName: "Kept Name" });
  });
});
