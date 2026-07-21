import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  discardProspectDraft,
  getProspectDraft,
  ProspectDraftRevisionError,
  updateProspectDraftFields,
} from "@/lib/prospects/draft-server";
import { PROSPECT_DRAFT_FIELD_KEYS } from "@/lib/prospects/draft-types";
import { prospectFormSchema } from "@/lib/prospects/prospect-form";

const updateSchema = z.object({
  values: z.partialRecord(z.enum(PROSPECT_DRAFT_FIELD_KEYS), z.string().max(4000)).default({}),
  form: prospectFormSchema.optional(),
  revision: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const discardSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  revision: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const guarded = await guardTenantApi();
  if (!guarded.ok) return guarded.response;
  const { id } = await context.params;
  const draft = await getProspectDraft({
    organizationId: guarded.ctx.session.organizationId,
    draftId: id,
    userId: guarded.ctx.session.uid,
  });
  if (!draft) return Response.json({ error: "Draft not found." }, { status: 404 });
  return Response.json({ draft });
}

export async function PATCH(req: Request, context: RouteContext) {
  const guarded = await guardTenantApi();
  if (!guarded.ok) return guarded.response;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id } = await context.params;
  let draft;
  try {
    draft = await updateProspectDraftFields({
      organizationId: guarded.ctx.session.organizationId,
      userId: guarded.ctx.session.uid,
      draftId: id,
      values: parsed.data.values,
      form: parsed.data.form,
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
  if (!draft) return Response.json({ error: "Draft not found." }, { status: 404 });
  return Response.json({ draft });
}

export async function DELETE(req: Request, context: RouteContext) {
  const guarded = await guardTenantApi();
  if (!guarded.ok) return guarded.response;
  const parsed = discardSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id } = await context.params;
  let discarded;
  try {
    discarded = await discardProspectDraft({
      organizationId: guarded.ctx.session.organizationId,
      userId: guarded.ctx.session.uid,
      draftId: id,
      reason: parsed.data.reason,
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
  if (!discarded) return Response.json({ error: "Active draft not found." }, { status: 404 });
  return Response.json({ ok: true });
}
