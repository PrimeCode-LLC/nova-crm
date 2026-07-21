import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  completeProspectDraft,
  ProspectDraftRevisionError,
} from "@/lib/prospects/draft-server";

type RouteContext = { params: Promise<{ id: string }> };
const completeSchema = z.object({
  allowIncomplete: z.boolean().optional(),
  revision: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request, context: RouteContext) {
  const guarded = await guardTenantApi();
  if (!guarded.ok) return guarded.response;
  const parsed = completeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id } = await context.params;
  let result;
  try {
    result = await completeProspectDraft({
      organizationId: guarded.ctx.session.organizationId,
      userId: guarded.ctx.session.uid,
      draftId: id,
      allowIncomplete: parsed.data.allowIncomplete,
      expectedRevision: parsed.data.expectedRevision ?? parsed.data.revision,
    });
  } catch (error) {
    if (error instanceof ProspectDraftRevisionError) {
      return Response.json(
        { error: error.message, code: error.code, currentRevision: error.currentRevision },
        { status: 409 },
      );
    }
    throw error;
  }
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ ok: true, leadId: result.leadId });
}
