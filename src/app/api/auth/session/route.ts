import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "@/lib/auth/constants";
import { setAppClaims } from "@/lib/auth/claims";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import {
  claimPendingOrgOwnerServer,
  createOrganizationServer,
  findOrganizationByPendingEmailServer,
} from "@/lib/platform/organizations-server";
import {
  findMembershipForUserServer,
  getMemberServer,
  hasSeatAvailableServer,
  upsertMemberServer,
} from "@/lib/platform/members-server";
import {
  lookupInviteByTokenServer,
  markInviteAcceptedServer,
} from "@/lib/platform/invites-server";
import { verifyOpenJoinTokenServer } from "@/lib/platform/open-join-server";
import { isFirestoreFailedPrecondition } from "@/lib/firestore/errors";

type SessionRequestBody = {
  idToken?: string;
  /** Free-text from the signup form, used to name the new org. */
  company?: string;
  /** Optional invite token from `/signup?invite=...`. */
  inviteToken?: string;
  /** Optional org-wide join token from `/signup?join=...` or login with the same param. */
  openJoinToken?: string;
};

export async function POST(req: Request) {
  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured. Set FIREBASE_ADMIN_* env vars." },
      { status: 503 },
    );
  }

  let body: SessionRequestBody;
  try {
    body = (await req.json()) as SessionRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idToken = body.idToken;
  const company =
    typeof body.company === "string" && body.company.trim()
      ? body.company.trim()
      : undefined;
  const inviteToken =
    typeof body.inviteToken === "string" && body.inviteToken.trim()
      ? body.inviteToken.trim()
      : undefined;
  const openJoinToken =
    typeof body.openJoinToken === "string" && body.openJoinToken.trim()
      ? body.openJoinToken.trim()
      : undefined;
  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idToken is required" }, { status: 400 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  if (Date.now() / 1000 - decoded.auth_time > 60 * 60) {
    return NextResponse.json(
      { error: "ID token is too old. Sign in again." },
      { status: 401 },
    );
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const uid = decoded.uid;
  const email = (decoded.email ?? "").toLowerCase();
  const displayName = decoded.name ?? email.split("@")[0] ?? "User";

  // ────────────── 1. Decide which org this session belongs to ──────────────
  // Order of precedence:
  //   (a) explicit invite token  → join that org
  //   (b) existing membership    → reuse
  //   (c) pending owner email    → claim platform-seeded org
  //   (d) signup with company    → create personal org, become owner
  //   (e) anything else          → stay org-less (will land on onboarding)
  let organizationId: string | undefined;
  let orgRole: "owner" | "admin" | "manager" | "member" | undefined;
  let isFreshSignup = false;
  let membershipPending = false;

  // (a) invite
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
    isFreshSignup = true;
  }

  // (a2) org-wide open join link — creates a pending member until an admin approves.
  if (!organizationId && openJoinToken) {
    const joinOrg = await verifyOpenJoinTokenServer(openJoinToken);
    if (!joinOrg) {
      return NextResponse.json(
        { error: "Join link is invalid or has been rotated. Ask an admin for a new link." },
        { status: 400 },
      );
    }
    const targetOrgId = joinOrg.orgId;
    let existingForJoin: Awaited<
      ReturnType<typeof findMembershipForUserServer>
    > = null;
    try {
      existingForJoin = await findMembershipForUserServer(uid);
    } catch (err: unknown) {
      if (isFirestoreFailedPrecondition(err)) {
        return NextResponse.json(
          {
            error:
              "Could not resolve your workspace (Firestore index still deploying). Run from `crm`: firebase deploy --only firestore:indexes.",
          },
          { status: 503 },
        );
      }
      throw err;
    }

    if (existingForJoin) {
      if (existingForJoin.organizationId !== targetOrgId) {
        return NextResponse.json(
          { error: "You already belong to a different workspace." },
          { status: 400 },
        );
      }
      if (existingForJoin.status === "active") {
        organizationId = existingForJoin.organizationId;
        orgRole = existingForJoin.role;
      } else if (existingForJoin.status === "pending") {
        membershipPending = true;
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
      isFreshSignup = true;
    }
  }

  // (b) reuse existing membership
  if (!organizationId && !membershipPending) {
    // Fast path: `users/{uid}.organizationId` + direct `members/{uid}` read — no
    // collection-group index (covers normal sign-in after at least one session).
    const userSnap = await db.collection("users").doc(uid).get();
    const uData = userSnap.exists ? userSnap.data() : undefined;
    const mirroredOrgId =
      typeof uData?.organizationId === "string" && uData.organizationId.trim()
        ? uData.organizationId.trim()
        : undefined;
    if (mirroredOrgId) {
      const member = await getMemberServer(mirroredOrgId, uid);
      if (member) {
        if (member.status === "pending") {
          membershipPending = true;
        } else if (member.status === "active") {
          organizationId = member.organizationId;
          orgRole = member.role;
        }
      }
    }
  }

  if (!organizationId && !membershipPending) {
    let existing;
    try {
      existing = await findMembershipForUserServer(uid);
    } catch (err: unknown) {
      if (isFirestoreFailedPrecondition(err)) {
        return NextResponse.json(
          {
            error:
              "Could not resolve your workspace (Firestore index still deploying, or first-time setup). Run from `crm`: firebase deploy --only firestore:indexes — then wait until the `members` / `uid` index is Enabled in the Firebase console.",
          },
          { status: 503 },
        );
      }
      throw err;
    }
    if (existing) {
      if (existing.status === "pending") {
        membershipPending = true;
      } else if (existing.status === "active") {
        organizationId = existing.organizationId;
        orgRole = existing.role;
      }
    }
  }

  // (c) platform-seeded "pending owner" record matching this email
  if (!organizationId && !membershipPending && email) {
    const pending = await findOrganizationByPendingEmailServer(email);
    if (pending) {
      const claim = await claimPendingOrgOwnerServer(pending.id, uid, email);
      if (!("error" in claim)) {
        await upsertMemberServer({
          organizationId: pending.id,
          uid,
          email,
          displayName,
          role: "owner",
          status: "active",
          invitedByUid: "platform-seed",
        });
        organizationId = pending.id;
        orgRole = "owner";
        isFreshSignup = true;
      }
    }
  }

  // (d) brand-new signup with a company name → bootstrap a personal org
  if (!organizationId && !membershipPending && company) {
    const created = await createOrganizationServer({
      name: company,
      ownerUid: uid,
      ownerEmail: email,
    });
    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: 400 });
    }
    await upsertMemberServer({
      organizationId: created.id,
      uid,
      email,
      displayName,
      role: "owner",
      status: "active",
      invitedByUid: "owner-bootstrap",
    });
    organizationId = created.id;
    orgRole = "owner";
    isFreshSignup = true;
  }

  // ────────────── 2. Mirror identity onto users/{uid} ──────────────
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const userPayload: Record<string, unknown> = {
    email,
    displayName,
    status: "active",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (company) userPayload.company = company;
  if (membershipPending) {
    let pendingOrgId = organizationId;
    if (!pendingOrgId) {
      try {
        pendingOrgId = (await findMembershipForUserServer(uid))?.organizationId;
      } catch {
        /* ignore — user doc may still list membershipPendingOrgId from prior write */
      }
    }
    if (pendingOrgId) {
      userPayload.membershipPendingOrgId = pendingOrgId;
    }
    userPayload.organizationId = FieldValue.delete();
    userPayload.orgRole = FieldValue.delete();
  } else {
    userPayload.membershipPendingOrgId = FieldValue.delete();
    if (organizationId) userPayload.organizationId = organizationId;
    if (orgRole) userPayload.orgRole = orgRole;
  }
  if (!snap.exists) {
    userPayload.createdAt = FieldValue.serverTimestamp();
    // Map org owner to 'director' for the legacy CRM role system; everyone
    // else lands as salesperson by default and can be re-roled in /admin/users.
    userPayload.roleId = orgRole === "owner" ? "director" : "salesperson";
    if (orgRole === "owner") userPayload.isSuperAdmin = true;
  }
  await userRef.set(userPayload, { merge: true });

  // ────────────── 3. Stamp custom claims (Firestore rules read these) ──────────────
  const platformAdmin = await isUserPlatformAdmin(uid, email);
  await setAppClaims(adminAuth, uid, {
    organizationId: membershipPending ? undefined : organizationId,
    orgRole: membershipPending ? undefined : orgRole,
    platformAdmin: platformAdmin || undefined,
  });

  // ────────────── 4. Mint session cookie ──────────────
  // Important: when claims change, the *session cookie* the client just
  // exchanged still embeds the OLD token. We refresh by rebuilding the cookie
  // from a NEW id token. To keep this endpoint single-roundtrip, we ask the
  // client to refresh its id token and re-call us *only* on fresh signups.
  // For login-of-existing-user, claims rarely change, so embedding the old
  // token is fine; rules will be satisfied on next refresh (Firebase auto-
  // refreshes id tokens hourly).
  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  const res = NextResponse.json({
    ok: true,
    organizationId: membershipPending ? null : (organizationId ?? null),
    orgRole: membershipPending ? null : (orgRole ?? null),
    membershipPending,
    needsClaimRefresh: isFreshSignup || membershipPending,
  });
  res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
  return res;
}
