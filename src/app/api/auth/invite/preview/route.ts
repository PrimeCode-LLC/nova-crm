import { NextResponse } from "next/server";
import { lookupInviteByTokenServer } from "@/lib/platform/invites-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

/** Public endpoint - used by /signup?invite=… to verify the link before account creation. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const lookup = await lookupInviteByTokenServer(token);
  if (!lookup.ok) {
    const reason =
      lookup.reason === "expired"
        ? "Invite expired."
        : lookup.reason === "revoked"
          ? "Invite was revoked."
          : lookup.reason === "accepted"
            ? "Invite already used."
            : "Invite not found.";
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  const org = await getOrganizationServer(lookup.invite.organizationId);
  return NextResponse.json({
    organizationName: org?.name ?? "Workspace",
    email: lookup.invite.email,
    role: lookup.invite.role,
  });
}
