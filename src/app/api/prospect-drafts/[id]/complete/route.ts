import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { completeProspectDraft } from "@/lib/prospects/draft-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: RouteContext) {
  const guarded = await guardTenantApi();
  if (!guarded.ok) return guarded.response;
  const { id } = await context.params;
  const result = await completeProspectDraft({
    organizationId: guarded.ctx.session.organizationId,
    userId: guarded.ctx.session.uid,
    draftId: id,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ ok: true, leadId: result.leadId });
}
