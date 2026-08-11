import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteCrmMirror,
  mirrorCrmEntityAfterWrite,
  type CrmEntity,
} from "@/lib/db/dual-write-crm";
import { isPostgresDualWriteCrmEnabled } from "@/lib/db/dual-write-crm-flags";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

const bodySchema = z
  .object({
    entity: z.enum(["account", "contact", "lead", "deal"]),
    id: z.string().min(1).max(128),
    action: z.enum(["upsert", "delete"]).default("upsert"),
  })
  .strict();

/**
 * POST /api/org/crm-mirror — mirror one CRM doc into Postgres (P2.6–P2.9).
 * No-op when dual-write flag is off or DATABASE_URL is unset.
 */
export async function POST(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  if (!isPostgresDualWriteCrmEnabled() || !isDatabaseConfigured()) {
    return NextResponse.json({ ok: true, mirrored: false, reason: "flag_or_db_off" });
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

  const { entity, id, action } = parsed.data;
  const organizationId = guard.ctx.session.organizationId;

  try {
    if (action === "delete") {
      await deleteCrmMirror(entity as CrmEntity, id);
    } else {
      await mirrorCrmEntityAfterWrite(entity as CrmEntity, id, { organizationId });
    }
    return NextResponse.json({ ok: true, mirrored: true });
  } catch (err) {
    console.error("[crm-mirror]", entity, id, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mirror failed" },
      { status: 500 },
    );
  }
}
