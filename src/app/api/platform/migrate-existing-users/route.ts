import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import { recordPlatformAudit } from "@/lib/platform/platform-audit-server";
import { setAppClaims } from "@/lib/auth/claims";
import { createOrganizationServer } from "@/lib/platform/organizations-server";
import {
  findMembershipForUserServer,
  upsertMemberServer,
} from "@/lib/platform/members-server";

/**
 * One-shot migration: for every user doc that has no `organizationId`,
 * create a personal workspace named after their `company` field (or email
 * domain), enroll them as owner, and stamp claims.
 *
 * Idempotent - re-running it skips users that already have a membership.
 * Platform-admin only.
 */
export async function POST() {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const snap = await db.collection(COLLECTIONS.users).get();
  const results: Array<{
    uid: string;
    email: string;
    action: "skipped" | "migrated" | "failed";
    organizationId?: string;
    error?: string;
  }> = [];

  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    const uid = doc.id;
    const email = String(data.email ?? "");
    const existingMembership = await findMembershipForUserServer(uid);
    if (existingMembership) {
      results.push({
        uid,
        email,
        action: "skipped",
        organizationId: existingMembership.organizationId,
      });
      continue;
    }

    const company =
      typeof data.company === "string" && data.company.trim()
        ? data.company.trim()
        : (email.split("@")[1] ?? "Workspace");

    const created = await createOrganizationServer({
      name: company,
      ownerUid: uid,
      ownerEmail: email || undefined,
    });
    if ("error" in created) {
      results.push({ uid, email, action: "failed", error: created.error });
      continue;
    }

    const member = await upsertMemberServer({
      organizationId: created.id,
      uid,
      email,
      displayName:
        (typeof data.displayName === "string" && data.displayName) ||
        email.split("@")[0] ||
        "User",
      role: "owner",
      status: "active",
      invitedByUid: "migration",
    });
    if ("error" in member) {
      results.push({ uid, email, action: "failed", error: member.error });
      continue;
    }

    await db.collection(COLLECTIONS.users).doc(uid).set(
      {
        organizationId: created.id,
        orgRole: "owner",
        roleId: data.roleId ?? "director",
        isSuperAdmin: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await setAppClaims(g.ctx.adminAuth, uid, {
      organizationId: created.id,
      orgRole: "owner",
    });

    results.push({
      uid,
      email,
      action: "migrated",
      organizationId: created.id,
    });
  }

  const summary = {
    total: results.length,
    migrated: results.filter((r) => r.action === "migrated").length,
    skipped: results.filter((r) => r.action === "skipped").length,
    failed: results.filter((r) => r.action === "failed").length,
    results,
  };

  await recordPlatformAudit({
    event: "migration.run",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    summary: `Legacy user migration: ${summary.migrated} migrated, ${summary.skipped} skipped, ${summary.failed} failed`,
    metadata: {
      migrated: summary.migrated,
      skipped: summary.skipped,
      failed: summary.failed,
    },
  });

  return NextResponse.json(summary);
}
