import { NextResponse } from "next/server";
import { z } from "zod";

import type { CrmEntity } from "@/lib/db/dual-write-crm";
import { assertCrmLeadMutationAllowed } from "@/lib/db/crm-write-authz";
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
import { crmModuleAllowedServer } from "@/lib/platform/guard-admin-feature";
import { cancelLeadOutreachServer } from "@/lib/email/cancel-lead-outreach-server";
import { cancelPendingScheduledEmailsForLeadServer } from "@/lib/email/scheduled-emails-server";
import type { ModuleCapability } from "@/lib/permissions/catalog";

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
  const viewerRole = guard.ctx.role;
  const viewerUid = guard.ctx.session.uid;
  const body = parsed.data;

  const moduleEntity: CrmEntity =
    body.action === "upsert_graph" || body.action === "bump_lead_activity"
      ? "lead"
      : (body.entity as CrmEntity);
  const capabilities: ModuleCapability[] =
    body.action === "delete"
      ? ["delete"]
      : body.action === "patch"
        ? ["edit"]
        : body.action === "bump_lead_activity"
          ? ["view"]
          : ["create", "edit"];
  if (!(await crmModuleAllowedServer(guard.ctx, moduleEntity, capabilities))) {
    return NextResponse.json(
      { ok: false, error: `Your role does not allow this change (${moduleEntity}).` },
      { status: 403 },
    );
  }

  try {
    if (body.action === "bump_lead_activity") {
      const authz = await assertCrmLeadMutationAllowed({
        organizationId,
        entity: "lead",
        id: body.id,
        action: "patch",
        viewerRole,
        viewerUid,
        patch: {},
      });
      if (!authz.ok) {
        return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
      }
    }

    if (body.action === "delete" || body.action === "patch" || body.action === "upsert") {
      const authz = await assertCrmLeadMutationAllowed({
        organizationId,
        entity: body.entity as CrmEntity,
        id: body.id,
        action: body.action,
        viewerRole,
        viewerUid,
        patch:
          body.action === "patch"
            ? body.patch
            : body.action === "upsert"
              ? body.doc
              : undefined,
        unset: body.action === "patch" ? body.unset : undefined,
      });
      if (!authz.ok) {
        return NextResponse.json(
          { ok: false, error: authz.error },
          { status: authz.status },
        );
      }
    }

    if (body.action === "upsert_graph") {
      const authz = await assertCrmLeadMutationAllowed({
        organizationId,
        entity: "lead",
        id: body.lead.id,
        action: "upsert",
        viewerRole,
        viewerUid,
        patch: body.lead.doc,
      });
      if (!authz.ok) {
        return NextResponse.json(
          { ok: false, error: authz.error },
          { status: authz.status },
        );
      }
    }

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
    if (body.action === "delete" && body.entity === "lead") {
      // A deleted lead must not keep receiving scheduled mail (QA 1.5 / LEAD-12).
      try {
        const reason = "Lead deleted";
        await cancelLeadOutreachServer({ organizationId, leadId: body.id, userId: viewerUid, reason });
        await cancelPendingScheduledEmailsForLeadServer({ organizationId, leadId: body.id, reason });
      } catch (err) {
        console.error("[org/crm-write] cancel outreach after lead delete failed", body.id, err);
      }
    }
    return NextResponse.json({ ok: true, source: "postgres" as const });
  } catch (err) {
    console.error("[org/crm-write]", body.action, err);
    // Id already used (e.g. by a record in another workspace): don't leak Prisma text.
    if ((err as { code?: unknown })?.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "A record with this id already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: "CRM write failed" }, { status: 500 });
  }
}
