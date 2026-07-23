import { NextResponse } from "next/server";
import { verifyOpenJoinTokenServer } from "@/lib/platform/open-join-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

/** Public - used by `/signup?join=…` to confirm the link before account creation. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token.trim()) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const verified = await verifyOpenJoinTokenServer(token);
  if (!verified) {
    return NextResponse.json(
      { error: "Join link is invalid or was rotated. Ask an admin for a new link." },
      { status: 400 },
    );
  }

  const org = await getOrganizationServer(verified.orgId);
  return NextResponse.json({
    organizationName: org?.name ?? "Workspace",
  });
}
