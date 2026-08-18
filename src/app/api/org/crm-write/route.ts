import { NextResponse } from "next/server";
import { z } from "zod";

import type { CrmEntity } from "@/lib/db/dual-write-crm";
import {
  deleteCrmEntityPostgres,
  bumpLeadActivityPostgres,
  patchCrmEntityPostgres,
  upsertCrmEntityPostgres,
  upsertLeadGraphPostgres,
} from "@/lib/db/crm-write-postgres";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { isPostgresSoleWriterCrmV1Enabled } from "@/lib/db/postgres-sole-writer-crm-flags";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

const entitySchema = z.enum(["account", "contact", "lead", "deal"]);

const upsertSchema = z
  .object({
    action: z.literal("upsert"),
    entity: entitySchema,
    id: z.string().min(1).max(128),
    doc: z.record(z.string(), z.unknown()),
  })
  .strict();

const patchSchema = z
  .object({
    action: z.literal("patch"),
    entity: entitySchema,
    id: z.string().min(1).max(128),
    patch: z.record(z.string(), z.unknown()).default({}),
    unset: z.array(z.string().min(1).max(64)).max(64).default([]),
  })
  .strict();

const deleteSchema = z
  .object({
    action: z.literal("delete"),
    entity: entitySchema,
    id: z.string().min(1).max(128),
    accountId: z.string().min(1).max(128).optional(),
    accountLeadCount: z.number().int().min(0).optional(),
  })
  .strict();

const graphSchema = z
  .object({
    action: z.literal("upsert_graph"),
    account: z.object({
      id: z.string().min(1).max(128),
      doc: z.record(z.string(), z.unknown()),
    }),
    contact: z.object({
      id: z.string().min(1).max(128),
      doc: z.record(z.string(), z.unknown()),
    }),
    lead: z.object({
      id: z.string().min(1).max(128),
      doc: z.record(z.string(), z.unknown()),
    }),
  })
  .strict();

const bumpActivitySchema = z
  .object({
    action: z.literal("bump_lead_activity"),
    id: z.string().min(1).max(128),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [
  upsertSchema,
  patchSchema,
  deleteSchema,
  graphSchema,
  bumpActivitySchema,
]);

/**
 * POST /api/org/crm-write — Postgres sole-writer CRM mutations (P6.2).
 * No-op / 503 when flag off or DATABASE_URL unset.
 */
export async function POST(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  if (!isPostgresSoleWriterCrmV1Enabled()) {
    return NextResponse.json(
      { ok: false, error: "Postgres sole writer flag is off", code: "flag_off" },
      { status: 409 },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const organizationId = guard.ctx.session.organizationId;
  const body = parsed.data;

  try {
    let result;
    switch (body.action) {
      case "upsert":
        result = await upsertCrmEntityPostgres(
          organizationId,
          body.entity as CrmEntity,
          body.id,
          body.doc,
        );
        break;
      case "patch":
        result = await patchCrmEntityPostgres(
          organizationId,
          body.entity as CrmEntity,
          body.id,
          body.patch,
          body.unset,
        );
        break;
      case "delete":
        result = await deleteCrmEntityPostgres(
          organizationId,
          body.entity as CrmEntity,
          body.id,
          {
            accountId: body.accountId,
            accountLeadCount: body.accountLeadCount,
          },
        );
        break;
      case "upsert_graph":
        result = await upsertLeadGraphPostgres(organizationId, {
          account: body.account,
          contact: body.contact,
          lead: body.lead,
        });
        break;
      case "bump_lead_activity":
        result = await bumpLeadActivityPostgres(organizationId, body.id);
        break;
    }

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, source: "postgres" as const });
  } catch (err) {
    console.error("[org/crm-write]", body.action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "CRM write failed" },
      { status: 500 },
    );
  }
}
