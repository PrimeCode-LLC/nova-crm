import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recordAudit } from "@/lib/documents/audit";
import { SYSTEM_ROLE_PRESETS } from "@/lib/permissions/role-presets";
import {
  assertCanManageRoles,
  sanitizeActions,
  sanitizeModules,
} from "@/lib/permissions/roles-api";
import {
  createOrgRole,
  listOrgRolesWithCounts,
} from "@/lib/permissions/roles-server";

const DATA_SCOPES = ["none", "own", "team", "department", "all"] as const;

const modulePermissionSchema = z.object({
  view: z.boolean(),
  create: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  scope: z.enum(DATA_SCOPES),
});

const modulesSchema = z.record(z.string(), modulePermissionSchema);
const actionsSchema = z.record(z.string(), z.boolean());

export async function GET() {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  try {
    const manage = await assertCanManageRoles(uid, orgId, g.ctx.role);
    if (!manage.ok) return manage.response;

    const roles = await listOrgRolesWithCounts(orgId, uid);
    return NextResponse.json({ roles });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list roles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    modules: modulesSchema.optional(),
    actions: actionsSchema.optional(),
    duplicateFromId: z.string().min(1).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const manage = await assertCanManageRoles(uid, orgId, g.ctx.role);
  if (!manage.ok) return manage.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const baseModules = body.modules
    ? sanitizeModules(body.modules)
    : SYSTEM_ROLE_PRESETS.salesperson.modules;
  const baseActions = body.actions ? sanitizeActions(body.actions) : {};

  try {
    const role = await createOrgRole(orgId, {
      name: body.name,
      description: body.description,
      modules: baseModules,
      actions: baseActions,
      duplicateFromId: body.duplicateFromId,
      actorUid: uid,
    });
    await recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "role.created",
      meta: { roleId: role.id, roleName: role.name },
      actorEmail: g.ctx.session.email ?? null,
    });
    return NextResponse.json({ role }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create role";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
