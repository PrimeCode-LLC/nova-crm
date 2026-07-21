import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  createManualProspectDraft,
  listProspectDraftPage,
} from "@/lib/prospects/draft-server";
import { PROSPECT_DRAFT_FIELD_KEYS } from "@/lib/prospects/draft-types";
import { prospectFormSchema } from "@/lib/prospects/prospect-form";

const createSchema = z.object({
  values: z.partialRecord(z.enum(PROSPECT_DRAFT_FIELD_KEYS), z.string().max(4000)).optional(),
  form: prospectFormSchema.optional(),
  origin: z.enum(["manual", "intent_radar"]).optional(),
  sourceContext: z.string().trim().max(100).optional(),
  destination: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

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
  const requestedSource = url.searchParams.get("source");
  const origin =
    requestedSource === "manual" || requestedSource === "intent_radar"
      ? requestedSource
      : undefined;
  const requestedReadiness = url.searchParams.get("readiness");
  const readiness =
    requestedReadiness === "ready" || requestedReadiness === "needs_review"
      ? requestedReadiness
      : undefined;
  const requestedLimit = Number(url.searchParams.get("limit") ?? "25");
  try {
    const page = await listProspectDraftPage({
      organizationId: guarded.ctx.session.organizationId,
      userId: mine ? guarded.ctx.session.uid : undefined,
      status,
      origin,
      readiness,
      search: url.searchParams.get("search") ?? undefined,
      limit: Number.isFinite(requestedLimit) ? requestedLimit : 25,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    return Response.json({ ...page, hasMore: Boolean(page.nextCursor) });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid prospect draft cursor.") {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function POST(req: Request) {
  const guarded = await guardTenantApi();
  if (!guarded.ok) return guarded.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const draft = await createManualProspectDraft({
    organizationId: guarded.ctx.session.organizationId,
    userId: guarded.ctx.session.uid,
    values: parsed.data.values,
    form: parsed.data.form,
    origin: parsed.data.origin,
    sourceContext: parsed.data.sourceContext,
    destination: parsed.data.destination,
    idempotencyKey:
      parsed.data.idempotencyKey ?? req.headers.get("Idempotency-Key") ?? undefined,
  });
  return Response.json({ draft }, { status: 201 });
}
