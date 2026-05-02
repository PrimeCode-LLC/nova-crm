import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import {
  createOrganizationServer,
  listOrganizationsServer,
  sanitizeOrganizationForApi,
} from "@/lib/platform/organizations-server";
import { upsertMemberServer } from "@/lib/platform/members-server";
import { setAppClaims } from "@/lib/auth/claims";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { getRequestOrigin } from "@/lib/invite-link";
import { sendSystemEmail } from "@/lib/email/send-system-email";
import { renderInviteEmail } from "@/lib/email/invite-email";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional(),
  status: z.enum(["trial", "active", "suspended"]).optional(),
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

  // Try to resolve the owner email to an existing Firebase user. If they exist
  // already, we wire them up as the owner immediately; otherwise we record
  // `pendingOwnerEmail` so the org claims itself when they sign up.
  let resolvedOwnerUid: string | null = null;
  if (ownerEmail) {
    try {
      const u = await g.ctx.adminAuth.getUserByEmail(ownerEmail);
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
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  let setupLink: string | null = null;
  let setupEmailDelivered = false;
  let setupEmailNote: string | undefined;

  if (resolvedOwnerUid && ownerEmail) {
    // Existing user: enroll as owner now.
    await upsertMemberServer({
      organizationId: result.id,
      uid: resolvedOwnerUid,
      email: ownerEmail,
      displayName: ownerEmail.split("@")[0] ?? ownerEmail,
      role: "owner",
      status: "active",
      invitedByUid: g.ctx.session.uid,
    });
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
    }
    await setAppClaims(g.ctx.adminAuth, resolvedOwnerUid, {
      organizationId: result.id,
      orgRole: "owner",
    });
  }

  // If an ownerEmail was supplied, send them a setup link. Existing users
  // get a "you've been added" notice; new users get a sign-up link with the
  // org name pre-filled (the org claims itself by `pendingOwnerEmail`).
  if (ownerEmail) {
    const origin = await getRequestOrigin();
    setupLink = resolvedOwnerUid
      ? `${origin.replace(/\/$/, "")}/login`
      : `${origin.replace(/\/$/, "")}/signup`;
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
          ? "SYSTEM_SMTP_* not set — share the link manually."
          : send.error;
    }
  }

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
