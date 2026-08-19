import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recordAudit } from "@/lib/documents/audit";
import {
  assertCanManageRoles,
  sanitizeActions,
  sanitizeModules,
} from "@/lib/permissions/roles-api";
import {
  deleteOrgRole,
  getOrgRole,
  recomputeOrgRoleMembers,
  resetOrgRoleToPreset,
  updateOrgRole,
} from "@/lib/permissions/roles-server";

const DATA_SCOPES = ["none", "own", "team", "department", "all"] as const;

const modulePermissionSchema = z.object({
  view: z.boolean(),
  create: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  scope: z.enum(DATA_SCOPES),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.union([z.string().trim().max(500), z.null()]).optional(),
    isActive: z.boolean().optional(),
    modules: z.record(z.string(), modulePermissionSchema).optional(),
    actions: z.record(z.string(), z.boolean()).optional(),
    resetToDefault: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.resetToDefault === true ||
      d.name !== undefined ||
      d.description !== undefined ||
      d.isActive !== undefined ||
      d.modules !== undefined ||
      d.actions !== undefined,
    { message: "At least one field is required" },
  );

type RouteCtx = { params: Promise<{ roleId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const { roleId } = await ctx.params;
  const orgId = g.ctx.session.organizationId;
  const manage = await assertCanManageRoles(g.ctx.session.uid, orgId, g.ctx.role);
  if (!manage.ok) return manage.response;

  try {
    const role = await getOrgRole(orgId, decodeURIComponent(roleId));
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    return NextResponse.json({ role });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load role";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const { roleId: rawId } = await ctx.params;
  const roleId = decodeURIComponent(rawId);
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

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.resetToDefault) {
      const role = await resetOrgRoleToPreset(orgId, roleId, uid);
      await recomputeOrgRoleMembers(orgId, role.id);
      await recordAudit({
        organizationId: orgId,
        actorUid: uid,
        event: "role.reset",
        meta: { roleId: role.id, roleName: role.name },
        actorEmail: g.ctx.session.email ?? null,
      });
      return NextResponse.json({ role });
    }

    const role = await updateOrgRole(orgId, roleId, {
      name: parsed.data.name,
      description: parsed.data.description,
      isActive: parsed.data.isActive,
      modules: parsed.data.modules
        ? sanitizeModules(parsed.data.modules)
        : undefined,
      actions: parsed.data.actions
        ? sanitizeActions(parsed.data.actions)
        : undefined,
      actorUid: uid,
    });
    await recomputeOrgRoleMembers(orgId, role.id);
    await recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "role.updated",
      meta: { roleId: role.id, roleName: role.name },
      actorEmail: g.ctx.session.email ?? null,
    });
    return NextResponse.json({ role });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update role";
    const status = message === "Role not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const { roleId: rawId } = await ctx.params;
  const roleId = decodeURIComponent(rawId);
  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const manage = await assertCanManageRoles(uid, orgId, g.ctx.role);
  if (!manage.ok) return manage.response;

  const existing = await getOrgRole(orgId, roleId);
  const result = await deleteOrgRole(orgId, roleId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: uid,
    event: "role.deleted",
    meta: {
      roleId,
      roleName: existing?.name ?? roleId,
    },
    actorEmail: g.ctx.session.email ?? null,
  });
  return NextResponse.json({ ok: true });
}
