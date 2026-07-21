import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  deleteMemberServer,
  getMemberServer,
  listMembersServer,
  setMemberRoleServer,
  setMemberStatusServer,
  hasSeatAvailableServer,
} from "@/lib/platform/members-server";
import { setAppClaims } from "@/lib/auth/claims";
import { recordAudit } from "@/lib/firestore/audit";
import type { AuditEvent } from "@/lib/firestore/audit";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";

const patchSchema = z.object({
  uid: z.string().min(1),
  role: z.enum(["owner", "admin", "manager", "member"]).optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
});

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const members = await listMembersServer(g.ctx.session.organizationId);
  return NextResponse.json({ members });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { uid, role, status } = parsed.data;
  const orgId = g.ctx.session.organizationId;

  // Only owners can promote / demote owners or admins.
  if (role && (role === "owner" || role === "admin") && g.ctx.role !== "owner") {
    return NextResponse.json(
      { error: "Only the owner can grant admin or owner roles." },
      { status: 403 },
    );
  }

  if (role) {
    const r = await setMemberRoleServer(orgId, uid, role);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    const db = getAdminDb();
    if (db) {
      await db
        .collection(COLLECTIONS.users)
        .doc(uid)
        .set(
          { orgRole: role, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
    }
    await recordAudit({
      organizationId: orgId,
      actorUid: g.ctx.session.uid,
      event: "member.role_changed",
      meta: { uid, role },
    });
  }
  if (status) {
    const beforeStatus = (await getMemberServer(orgId, uid))?.status ?? "active";
    if (status === "active" && beforeStatus === "pending") {
      const seat = await hasSeatAvailableServer(orgId);
      if ("error" in seat) {
        return NextResponse.json({ error: seat.error }, { status: 400 });
      }
    }
    const r = await setMemberStatusServer(orgId, uid, status);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });

    let auditEvent: AuditEvent = "member.enabled";
    if (status === "disabled") auditEvent = "member.disabled";
    else if (beforeStatus === "pending" && status === "active") {
      auditEvent = "member.approved";
    } else if (beforeStatus === "disabled" && status === "active") {
      auditEvent = "member.enabled";
    }

    await recordAudit({
      organizationId: orgId,
      actorUid: g.ctx.session.uid,
      event: auditEvent,
      meta: { uid },
    });

    if (beforeStatus === "pending" && status === "active") {
      const member = await getMemberServer(orgId, uid);
      const db = getAdminDb();
      if (db) {
        await db
          .collection(COLLECTIONS.users)
          .doc(uid)
          .set(
            {
              organizationId: orgId,
              orgRole: member?.role ?? "member",
              membershipPendingOrgId: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
      }
      await g.ctx.adminAuth.revokeRefreshTokens(uid);
    }
  }

  // Refresh claims so the affected user's next ID-token refresh picks up the change.
  if (role || status) {
    const member = await getMemberServer(orgId, uid);
    const effectiveStatus = member?.status ?? "active";
    if (effectiveStatus === "disabled") {
      const db = getAdminDb();
      await db
        ?.collection(COLLECTIONS.users)
        .doc(uid)
        .set(
          {
            organizationId: FieldValue.delete(),
            orgRole: FieldValue.delete(),
            membershipPendingOrgId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      await setAppClaims(g.ctx.adminAuth, uid, {
        organizationId: undefined,
        orgRole: undefined,
      });
      await g.ctx.adminAuth.revokeRefreshTokens(uid);
    } else if (effectiveStatus === "active") {
      const db = getAdminDb();
      await db
        ?.collection(COLLECTIONS.users)
        .doc(uid)
        .set(
          {
            organizationId: orgId,
            orgRole: member?.role ?? "member",
            membershipPendingOrgId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      await setAppClaims(g.ctx.adminAuth, uid, {
        organizationId: orgId,
        orgRole: member?.role,
      });
    } else {
      await setAppClaims(g.ctx.adminAuth, uid, {
        organizationId: undefined,
        orgRole: undefined,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid")?.trim();
  if (!uid) {
    return NextResponse.json({ error: "uid required" }, { status: 400 });
  }
  if (uid === g.ctx.session.uid) {
    return NextResponse.json(
      { error: "You can't remove yourself. Transfer ownership first." },
      { status: 400 },
    );
  }
  const orgId = g.ctx.session.organizationId;
  const r = await deleteMemberServer(orgId, uid);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  const db = getAdminDb();
  if (db) {
    await db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .set(
        {
          organizationId: FieldValue.delete(),
          orgRole: FieldValue.delete(),
          membershipPendingOrgId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }
  await setAppClaims(g.ctx.adminAuth, uid, {});
  await g.ctx.adminAuth.revokeRefreshTokens(uid);
  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "member.removed",
    meta: { uid },
  });
  return NextResponse.json({ ok: true });
}
