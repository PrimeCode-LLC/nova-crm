import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  findMembershipForUserServer,
  getMemberServer,
  hasSeatAvailableServer,
  upsertMemberServer,
} from "@/lib/platform/members-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { isFirestoreFailedPrecondition } from "@/lib/firestore/errors";
import { setAppClaims } from "@/lib/auth/claims";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { recordAudit } from "@/lib/firestore/audit";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1).max(120).optional(),
  role: z.enum(["owner", "admin", "manager", "member"]).default("member"),
});

function adminAuthErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi({ minRole: "admin" });
    if (!g.ok) return g.response;

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    if (
      (parsed.data.role === "owner" || parsed.data.role === "admin") &&
      g.ctx.role !== "owner"
    ) {
      return NextResponse.json(
        { error: "Only the owner can assign owner or admin." },
        { status: 403 },
      );
    }

    const orgId = g.ctx.session.organizationId;
    const seat = await hasSeatAvailableServer(orgId);
    if ("error" in seat) {
      return NextResponse.json({ error: seat.error }, { status: 400 });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const displayName = (
      parsed.data.displayName?.trim() ||
      email.split("@")[0] ||
      "User"
    ).slice(0, 120);

    let uid: string;
    let createdNewFirebaseUser = false;

    try {
      const rec = await g.ctx.adminAuth.createUser({
        email,
        password: parsed.data.password,
        displayName,
        emailVerified: false,
      });
      uid = rec.uid;
      createdNewFirebaseUser = true;
    } catch (err: unknown) {
      if (adminAuthErrorCode(err) === "auth/email-already-exists") {
        try {
          const existing = await g.ctx.adminAuth.getUserByEmail(email);
          uid = existing.uid;
        } catch {
          return NextResponse.json(
            { error: "Could not load the existing account for that email." },
            { status: 400 },
          );
        }
      } else {
        const msg =
          adminAuthErrorCode(err) === "auth/weak-password"
            ? "Password is too weak for Firebase. Use a longer mix of letters and numbers."
            : "Could not create the login. Check the email and password.";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    const existingMember = await getMemberServer(orgId, uid);
    if (existingMember) {
      if (createdNewFirebaseUser) {
        try {
          await g.ctx.adminAuth.deleteUser(uid);
        } catch {
          /* best-effort rollback */
        }
      }
      return NextResponse.json(
        {
          error:
            "This person is already in this workspace. Use Team to change their role or status.",
        },
        { status: 400 },
      );
    }

    let otherMembership: Awaited<
      ReturnType<typeof findMembershipForUserServer>
    > = null;
    try {
      otherMembership = await findMembershipForUserServer(uid);
    } catch (err: unknown) {
      if (!isFirestoreFailedPrecondition(err)) throw err;
      // Collection-group `members` query needs a deployed index (see `firestore.indexes.json`).
      // When the index is missing or still building, fall back to `users/{uid}.organizationId`.
      const db = getAdminDb();
      if (db) {
        const snap = await db.collection("users").doc(uid).get();
        const mirrorOrg = snap.data()?.organizationId;
        if (
          typeof mirrorOrg === "string" &&
          mirrorOrg.trim() &&
          mirrorOrg.trim() !== orgId
        ) {
          if (createdNewFirebaseUser) {
            try {
              await g.ctx.adminAuth.deleteUser(uid);
            } catch {
              /* best-effort rollback */
            }
          }
          return NextResponse.json(
            {
              error:
                "This account already belongs to another workspace. They must leave it before joining here.",
            },
            { status: 400 },
          );
        }
      }
      otherMembership = null;
    }

    if (otherMembership && otherMembership.organizationId !== orgId) {
      if (createdNewFirebaseUser) {
        try {
          await g.ctx.adminAuth.deleteUser(uid);
        } catch {
          /* best-effort rollback */
        }
      }
      return NextResponse.json(
        {
          error:
            "This account already belongs to another workspace. They must leave it before joining here.",
        },
        { status: 400 },
      );
    }

    const up = await upsertMemberServer({
      organizationId: orgId,
      uid,
      email,
      displayName,
      role: parsed.data.role,
      status: "active",
      invitedByUid: g.ctx.session.uid,
    });

    if ("error" in up) {
      if (createdNewFirebaseUser) {
        try {
          await g.ctx.adminAuth.deleteUser(uid);
        } catch {
          /* best-effort rollback */
        }
      }
      return NextResponse.json({ error: up.error }, { status: 500 });
    }

    const db = getAdminDb();
    if (db) {
      const userRef = db.collection("users").doc(uid);
      const snap = await userRef.get();
      const userPayload: Record<string, unknown> = {
        email,
        displayName,
        status: "active",
        organizationId: orgId,
        orgRole: parsed.data.role,
        membershipPendingOrgId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!snap.exists) {
        userPayload.createdAt = FieldValue.serverTimestamp();
        userPayload.roleId =
          parsed.data.role === "owner" ? "director" : "salesperson";
        if (parsed.data.role === "owner") userPayload.isSuperAdmin = true;
      }
      await userRef.set(userPayload, { merge: true });
    }

    const platformAdmin = await isUserPlatformAdmin(uid, email);
    await setAppClaims(g.ctx.adminAuth, uid, {
      organizationId: orgId,
      orgRole: parsed.data.role,
      platformAdmin: platformAdmin || undefined,
    });
    await g.ctx.adminAuth.revokeRefreshTokens(uid);

    await recordAudit({
      organizationId: orgId,
      actorUid: g.ctx.session.uid,
      event: "member.provisioned",
      meta: {
        email,
        role: parsed.data.role,
        newFirebaseUser: createdNewFirebaseUser,
      },
    });

    return NextResponse.json({
      ok: true,
      uid,
      email,
      linkedExistingFirebaseUser: !createdNewFirebaseUser,
    });
  } catch (e: unknown) {
    if (isFirestoreFailedPrecondition(e)) {
      return NextResponse.json(
        {
          error:
            "Firestore membership index is not ready. From the `crm` folder run: firebase deploy --only firestore:indexes, then open the Firebase console → Firestore → Indexes and wait until the `members` collection group index is Enabled.",
        },
        { status: 503 },
      );
    }
    const message = e instanceof Error ? e.message : "Provisioning failed.";
    console.error("[provision-login]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
