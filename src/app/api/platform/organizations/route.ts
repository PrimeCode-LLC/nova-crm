import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
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
import { resolveNovaUidByEmailServer } from "@/lib/auth/clerk-identity";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getRequestOrigin, authSignInPath, authSignUpPath } from "@/lib/invite-link";
import { sendSystemEmail } from "@/lib/email/send-system-email";
import { renderInviteEmail } from "@/lib/email/invite-email";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { provisionCrmProfileServer } from "@/lib/platform/crm-profile-provision";
import { recordPlatformAudit } from "@/lib/platform/platform-audit-server";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional(),
  status: z.enum(["trial", "active", "suspended", "archived"]).optional(),
  planId: z.enum(["free", "pro", "enterprise"]).optional(),
  maxUsers: z.number().int().positive().max(100_000).optional(),
  /** Email of the human who will own this workspace. */
  ownerEmail: z.string().email().optional().or(z.literal("")),
  settings: z
    .object({
      billingEmail: z.string().email().optional().or(z.literal("")),
      operatorNotes: z.string().max(5000).optional(),
    })
    .optional(),
});

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

  const { settings: s, ownerEmail: rawOwnerEmail, ...rest } = parsed.data;
  const ownerEmail = rawOwnerEmail?.trim().toLowerCase() || undefined;
  const settings =
    s === undefined
      ? undefined
      : {
          billingEmail: s.billingEmail || undefined,
          operatorNotes: s.operatorNotes,
        };

  let resolvedOwnerUid: string | null = null;
  if (ownerEmail) {
    const clerkUser = await resolveNovaUidByEmailServer(ownerEmail);
    if (clerkUser) {
      const membershipCheck = await assertUserHasNoWorkspaceServer(clerkUser.uid, {
        context: "owner",
      });
      if ("error" in membershipCheck) {
        return NextResponse.json({ error: membershipCheck.error }, { status: 400 });
      }
      resolvedOwnerUid = clerkUser.uid;
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
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  let setupLink: string | null = null;
  let setupEmailDelivered = false;
  let setupEmailNote: string | undefined;

  if (resolvedOwnerUid && ownerEmail) {
    const displayNameForMember = ownerEmail.split("@")[0] ?? ownerEmail;

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
      await db.collection("users").doc(resolvedOwnerUid).set(
        {
          organizationId: result.id,
          orgRole: "owner",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await provisionCrmProfileServer(db, {
        uid: resolvedOwnerUid,
        organizationId: result.id,
        orgRole: "owner",
        email: ownerEmail,
        displayName: displayNameForMember,
        actorUid: g.ctx.session.uid,
      });
    }

    const platformAdmin = await isUserPlatformAdmin(resolvedOwnerUid, ownerEmail);
    await setAppClaims(g.ctx.adminAuth, resolvedOwnerUid, {
      organizationId: result.id,
      orgRole: "owner",
      platformAdmin: platformAdmin || undefined,
    });
  }

  if (ownerEmail) {
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

  await recordPlatformAudit({
    event: "org.created",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    targetOrgId: result.id,
    summary: `Created organization ${rest.name}`,
    metadata: { slug: result.slug, ownerEmail: ownerEmail ?? null },
  });

  return NextResponse.json(
    {
      id: result.id,
      slug: result.slug,
      ownerLinked: Boolean(resolvedOwnerUid),
      ownerEmail: ownerEmail ?? null,
      setupLink,
      setupEmailDelivered,
      setupEmailNote,
    },
    { status: 201 },
  );
}
