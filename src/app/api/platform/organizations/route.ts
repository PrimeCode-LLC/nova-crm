import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import { firebaseAdminRequiredResponse } from "@/lib/firebase/require-admin-auth";
import {
  createOrganizationServer,
  listOrganizationsServer,
  sanitizeOrganizationForApi,
} from "@/lib/platform/organizations-server";
import {
  assertUserHasNoWorkspaceServer,
  upsertMemberServer,
} from "@/lib/platform/members-server";
import { setAppClaims } from "@/lib/auth/claims";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { getRequestOrigin, authSignInPath, authSignUpPath } from "@/lib/invite-link";
import { sendSystemEmail } from "@/lib/email/send-system-email";
import { renderInviteEmail } from "@/lib/email/invite-email";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { recordAudit } from "@/lib/firestore/audit";

const createSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(80).optional(),
    status: z.enum(["trial", "active", "suspended"]).optional(),
    planId: z.enum(["free", "pro", "enterprise"]).optional(),
    maxUsers: z.number().int().positive().max(100_000).optional(),
    /** Email of the human who will own this workspace. */
    ownerEmail: z.string().email().optional().or(z.literal("")),
    /** When set with owner email, creates or links a Firebase password login like Team → Create login. */
    ownerPassword: z.string().min(8).max(128).optional().or(z.literal("")),
    ownerDisplayName: z.string().min(1).max(120).optional().or(z.literal("")),
    settings: z
      .object({
        billingEmail: z.string().email().optional().or(z.literal("")),
        operatorNotes: z.string().max(5000).optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    const pw = data.ownerPassword?.trim();
    if (!pw) return;
    if (!data.ownerEmail?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Owner email is required when creating a login.",
        path: ["ownerEmail"],
      });
    }
  });

function adminAuthErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}

export async function GET() {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const items = await listOrganizationsServer();
  return NextResponse.json({
    organizations: items.map(sanitizeOrganizationForApi),
  });
}

export async function POST(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Firebase password provisioning still needs Admin Auth; Clerk-only deploys
  // should omit ownerPassword and invite via Clerk instead.
  if (parsed.data.ownerPassword?.trim()) {
    const missingAdmin = firebaseAdminRequiredResponse(g.ctx.adminAuth);
    if (missingAdmin) return missingAdmin;
  }
  const adminAuth = g.ctx.adminAuth;

  const {
    settings: s,
    ownerEmail: rawOwnerEmail,
    ownerPassword: rawOwnerPassword,
    ownerDisplayName: rawOwnerDisplayName,
    ...rest
  } = parsed.data;
  const ownerEmail = rawOwnerEmail?.trim().toLowerCase() || undefined;
  const ownerPassword = rawOwnerPassword?.trim() || undefined;
  const ownerDisplayNameFromInput =
    rawOwnerDisplayName?.trim() ||
    (ownerEmail ? ownerEmail.split("@")[0] || "User" : "");
  const settings =
    s === undefined
      ? undefined
      : {
          billingEmail: s.billingEmail || undefined,
          operatorNotes: s.operatorNotes,
        };

  let resolvedOwnerUid: string | null = null;
  let ownerLoginProvisioned = false;
  let linkedExistingFirebaseUser = false;
  let ownerProvisionCreatedNewFirebaseUser = false;

  if (ownerEmail && ownerPassword) {
    let uid: string;
    let createdNewFirebaseUser = false;
    try {
      const rec = await adminAuth!.createUser({
        email: ownerEmail,
        password: ownerPassword,
        displayName: ownerDisplayNameFromInput.slice(0, 120),
        emailVerified: false,
      });
      uid = rec.uid;
      createdNewFirebaseUser = true;
    } catch (err: unknown) {
      if (adminAuthErrorCode(err) === "auth/email-already-exists") {
        try {
          const existing = await adminAuth!.getUserByEmail(ownerEmail);
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

    const membershipCheck = await assertUserHasNoWorkspaceServer(uid, {
      context: "owner",
    });
    if ("error" in membershipCheck) {
      if (createdNewFirebaseUser) {
        try {
          await adminAuth!.deleteUser(uid);
        } catch {
          /* best-effort rollback */
        }
      }
      return NextResponse.json({ error: membershipCheck.error }, { status: 400 });
    }

    resolvedOwnerUid = uid;
    ownerLoginProvisioned = true;
    linkedExistingFirebaseUser = !createdNewFirebaseUser;
    ownerProvisionCreatedNewFirebaseUser = createdNewFirebaseUser;
  } else if (ownerEmail) {
    // Resolve by email only: existing Firebase user is linked; otherwise
    // `pendingOwnerEmail` is set so the org claims itself when they sign up.
    try {
      const u = await adminAuth!.getUserByEmail(ownerEmail);
      const membershipCheck = await assertUserHasNoWorkspaceServer(u.uid, {
        context: "owner",
      });
      if ("error" in membershipCheck) {
        return NextResponse.json({ error: membershipCheck.error }, { status: 400 });
      }
      resolvedOwnerUid = u.uid;
    } catch {
      resolvedOwnerUid = null;
    }
  }

  const result = await createOrganizationServer({
    ...rest,
    settings,
    ownerUid: resolvedOwnerUid ?? undefined,
    ownerEmail: resolvedOwnerUid ? ownerEmail : undefined,
    pendingOwnerEmail: resolvedOwnerUid ? undefined : ownerEmail,
  });
  if ("error" in result) {
    if (ownerProvisionCreatedNewFirebaseUser && resolvedOwnerUid) {
      try {
        await adminAuth!.deleteUser(resolvedOwnerUid);
      } catch {
        /* best-effort rollback */
      }
    }
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  let setupLink: string | null = null;
  let setupEmailDelivered = false;
  let setupEmailNote: string | undefined;

  if (resolvedOwnerUid && ownerEmail) {
    const displayNameForMember = ownerLoginProvisioned
      ? ownerDisplayNameFromInput.slice(0, 120)
      : (ownerEmail.split("@")[0] ?? ownerEmail);

    const up = await upsertMemberServer({
      organizationId: result.id,
      uid: resolvedOwnerUid,
      email: ownerEmail,
      displayName: displayNameForMember,
      role: "owner",
      status: "active",
      invitedByUid: g.ctx.session.uid,
    });
    if ("error" in up) {
      return NextResponse.json({ error: up.error }, { status: 500 });
    }

    const db = getAdminDb();
    if (db) {
      const userRef = db.collection("users").doc(resolvedOwnerUid);
      if (ownerLoginProvisioned) {
        const snap = await userRef.get();
        const userPayload: Record<string, unknown> = {
          email: ownerEmail,
          displayName: displayNameForMember,
          status: "active",
          organizationId: result.id,
          orgRole: "owner",
          membershipPendingOrgId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (!snap.exists) {
          userPayload.createdAt = FieldValue.serverTimestamp();
          userPayload.roleId = "director";
          userPayload.isSuperAdmin = true;
        }
        await userRef.set(userPayload, { merge: true });
      } else {
        await userRef.set(
          {
            organizationId: result.id,
            orgRole: "owner",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    const platformAdmin = await isUserPlatformAdmin(
      resolvedOwnerUid,
      ownerEmail,
    );
    await setAppClaims(adminAuth, resolvedOwnerUid, {
      organizationId: result.id,
      orgRole: "owner",
      platformAdmin: platformAdmin || undefined,
    });

    if (ownerLoginProvisioned) {
      await adminAuth!.revokeRefreshTokens(resolvedOwnerUid);
      await recordAudit({
        organizationId: result.id,
        actorUid: g.ctx.session.uid,
        event: "member.provisioned",
        meta: {
          email: ownerEmail,
          role: "owner",
          newFirebaseUser: !linkedExistingFirebaseUser,
          via: "platform.organization.create",
        },
      });
    }
  }

  // If an ownerEmail was supplied (invite / signup flow only), send a setup link.
  if (ownerEmail && !ownerPassword) {
    const origin = await getRequestOrigin();
    setupLink = resolvedOwnerUid
      ? `${origin.replace(/\/$/, "")}${authSignInPath()}`
      : `${origin.replace(/\/$/, "")}${authSignUpPath()}`;
    const email = renderInviteEmail({
      organizationName: rest.name,
      inviterName: g.ctx.session.name,
      recipientEmail: ownerEmail,
      role: "owner",
      acceptUrl: setupLink,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const send = await sendSystemEmail({
      to: ownerEmail,
      subject: `Your ${rest.name} workspace is ready`,
      html: email.html.replace(
        "Accept invitation",
        resolvedOwnerUid ? "Sign in" : "Set up workspace",
      ),
      text: email.text,
    });
    setupEmailDelivered = send.ok;
    if (!send.ok) {
      setupEmailNote =
        send.reason === "not_configured"
          ? "SYSTEM_SMTP_* not set, share the link manually."
          : send.error;
    }
  }

  return NextResponse.json(
    {
      id: result.id,
      slug: result.slug,
      ownerLinked: Boolean(resolvedOwnerUid),
      ownerEmail: ownerEmail ?? null,
      ownerLoginProvisioned,
      linkedExistingFirebaseUser: ownerLoginProvisioned
        ? linkedExistingFirebaseUser
        : null,
      setupLink,
      setupEmailDelivered,
      setupEmailNote,
    },
    { status: 201 },
  );
}
