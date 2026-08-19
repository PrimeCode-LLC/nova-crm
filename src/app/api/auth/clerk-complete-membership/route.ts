import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { isClerkAuthV1ServerEnabled } from "@/lib/auth/clerk-flags";
import { resolveClerkIdentity, syncClerkNovaClaims } from "@/lib/auth/clerk-identity";
import { setAppClaims } from "@/lib/auth/claims";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import {
  assertNotMemberOfOtherOrgServer,
  findMembershipForUserServer,
  hasSeatAvailableServer,
  upsertMemberServer,
} from "@/lib/platform/members-server";
import {
  lookupInviteByTokenServer,
  markInviteAcceptedServer,
} from "@/lib/platform/invites-server";
import { verifyOpenJoinTokenServer } from "@/lib/platform/open-join-server";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { provisionCrmProfileServer } from "@/lib/platform/crm-profile-provision";

const bodySchema = z.object({
  inviteToken: z.string().min(1).optional(),
  openJoinToken: z.string().min(1).optional(),
});

/**
 * P5.4: After Clerk sign-up/sign-in, accept invite or open-join using the
 * bridged Nova uid (same semantics as `/api/auth/session` invite paths).
 */
export async function POST(req: Request) {
  if (!isClerkAuthV1ServerEnabled()) {
    return NextResponse.json({ error: "Clerk auth is not enabled." }, { status: 404 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "inviteToken or openJoinToken required" }, { status: 400 });
  }
  const inviteToken = parsed.data.inviteToken?.trim();
  const openJoinToken = parsed.data.openJoinToken?.trim();
  if (!inviteToken && !openJoinToken) {
    return NextResponse.json({ error: "inviteToken or openJoinToken required" }, { status: 400 });
  }

  const identity = await resolveClerkIdentity(clerkUser);
  const uid = identity.uid;
  const email = (identity.email ?? "").toLowerCase();
  const displayName = identity.name ?? email.split("@")[0] ?? "User";

  const adminAuth = getAdminAuth();
  const db = getAdminDb();
  if (!adminAuth || !db) {
    return NextResponse.json({ error: "Firebase Admin is not configured." }, { status: 503 });
  }

  let organizationId: string | undefined;
  let orgRole: "owner" | "admin" | "manager" | "member" | undefined;
  let membershipPending = false;

  if (inviteToken) {
    const lookup = await lookupInviteByTokenServer(inviteToken);
    if (!lookup.ok) {
      const reason =
        lookup.reason === "expired"
          ? "Invite expired."
          : lookup.reason === "revoked"
            ? "Invite was revoked."
            : lookup.reason === "accepted"
              ? "Invite was already used."
              : "Invite not found.";
      return NextResponse.json({ error: reason }, { status: 400 });
    }
    const invite = lookup.invite;
    if (email && invite.email && invite.email !== email) {
      return NextResponse.json(
        { error: `This invite is for ${invite.email}, not ${email}.` },
        { status: 400 },
      );
    }
    const seat = await hasSeatAvailableServer(invite.organizationId);
    if ("error" in seat) {
      return NextResponse.json({ error: seat.error }, { status: 400 });
    }
    const membershipCheck = await assertNotMemberOfOtherOrgServer(
      uid,
      invite.organizationId,
    );
    if ("error" in membershipCheck) {
      return NextResponse.json({ error: membershipCheck.error }, { status: 400 });
    }
    await upsertMemberServer({
      organizationId: invite.organizationId,
      uid,
      email,
      displayName,
      role: invite.role,
      status: "active",
      invitedByUid: invite.createdByUid,
    });
    await markInviteAcceptedServer(invite.organizationId, invite.id, uid);
    organizationId = invite.organizationId;
    orgRole = invite.role;
  } else if (openJoinToken) {
    const joinOrg = await verifyOpenJoinTokenServer(openJoinToken);
    if (!joinOrg) {
      return NextResponse.json(
        { error: "Join link is invalid or has been rotated. Ask an admin for a new link." },
        { status: 400 },
      );
    }
    const targetOrgId = joinOrg.orgId;
    const existing = await findMembershipForUserServer(uid);
    if (existing) {
      if (existing.organizationId !== targetOrgId) {
        return NextResponse.json(
          { error: "You already belong to a different workspace." },
          { status: 400 },
        );
      }
      if (existing.status === "active") {
        organizationId = existing.organizationId;
        orgRole = existing.role;
      } else if (existing.status === "pending") {
        membershipPending = true;
        organizationId = existing.organizationId;
      } else {
        return NextResponse.json(
          { error: "Your membership in this workspace is not active." },
          { status: 400 },
        );
      }
    } else {
      await upsertMemberServer({
        organizationId: targetOrgId,
        uid,
        email,
        displayName,
        role: "member",
        status: "pending",
        invitedByUid: "open-join-link",
      });
      membershipPending = true;
      organizationId = targetOrgId;
    }
  }

  const platformAdmin = await isUserPlatformAdmin(uid, email);

  const userPayload: Record<string, unknown> = {
    email,
    displayName,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (membershipPending) {
    userPayload.membershipPendingOrgId = organizationId;
    userPayload.organizationId = FieldValue.delete();
    userPayload.orgRole = FieldValue.delete();
  } else if (organizationId) {
    userPayload.membershipPendingOrgId = FieldValue.delete();
    userPayload.organizationId = organizationId;
    if (orgRole) userPayload.orgRole = orgRole;
  }
  await db.collection(COLLECTIONS.users).doc(uid).set(userPayload, { merge: true });

  if (!membershipPending && organizationId && orgRole) {
    await provisionCrmProfileServer(db, {
      uid,
      organizationId,
      orgRole,
      email,
      displayName,
      actorUid: uid,
    });
  }

  if (!membershipPending && organizationId) {
    await setAppClaims(adminAuth, uid, {
      organizationId,
      orgRole,
      platformAdmin: platformAdmin || undefined,
    });
  }

  await syncClerkNovaClaims(userId, {
    novaUid: uid,
    organizationId: membershipPending ? undefined : organizationId,
    orgRole: membershipPending ? undefined : orgRole,
    platformAdmin: platformAdmin || undefined,
  });

  return NextResponse.json({
    ok: true,
    organizationId: organizationId ?? null,
    orgRole: orgRole ?? null,
    membershipPending,
  });
}
