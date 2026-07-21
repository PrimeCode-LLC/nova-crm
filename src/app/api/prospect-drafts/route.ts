import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { listProspectDrafts } from "@/lib/prospects/draft-server";

export async function GET(req: Request) {
  const guarded = await guardTenantApi();
  if (!guarded.ok) return guarded.response;
  const url = new URL(req.url);
  const requestedStatus = url.searchParams.get("status");
  const status =
    requestedStatus === "active" ||
    requestedStatus === "completed" ||
    requestedStatus === "discarded"
      ? requestedStatus
      : undefined;
  const mine = url.searchParams.get("owner") !== "all";
  const drafts = await listProspectDrafts({
    organizationId: guarded.ctx.session.organizationId,
    userId: mine ? guarded.ctx.session.uid : undefined,
    status,
  });
  return Response.json({ drafts });
}
