import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getVerifiedSession } from "@/lib/auth/server";
import { setAppClaims } from "@/lib/auth/claims";
import { createOrganizationServer } from "@/lib/platform/organizations-server";
import {
  findMembershipForUserServer,
  upsertMemberServer,
} from "@/lib/platform/members-server";

const schema = z.object({
  company: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const adminAuth = getAdminAuth();
  const db = getAdminDb();
  if (!adminAuth || !db) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured." },
      { status: 503 },
    );
  }

  const session = await getVerifiedSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await findMembershipForUserServer(session.uid);
  if (existing) {
    if (existing.status === "pending") {
      return NextResponse.json(
        {
          error:
            "Your join request is still pending. Wait for an admin to approve it, or contact them for a new link.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "You already belong to a workspace." },
      { status: 400 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const created = await createOrganizationServer({
    name: parsed.data.company,
    ownerUid: session.uid,
    ownerEmail: session.email,
  });
  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: 400 });
  }

  await upsertMemberServer({
    organizationId: created.id,
    uid: session.uid,
    email: session.email ?? "",
    displayName: session.name ?? session.email ?? "User",
    role: "owner",
    status: "active",
    invitedByUid: "owner-bootstrap",
  });

  await db.collection("users").doc(session.uid).set(
    {
      organizationId: created.id,
      orgRole: "owner",
      roleId: "director",
      isSuperAdmin: true,
      company: parsed.data.company,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await setAppClaims(adminAuth, session.uid, {
    organizationId: created.id,
    orgRole: "owner",
    platformAdmin: session.platformAdmin || undefined,
  });

  return NextResponse.json({ ok: true, organizationId: created.id });
}
