/**
 * CRM rows (leads / accounts / contacts / deals) reachable through the generic
 * workspace-documents API must get the same module-permission and record-scope
 * checks as /api/org/crm-write and the CRM detail routes (QA 1.8). Without
 * this, a member could read or edit colleagues' records by document path.
 */

import { assertCrmLeadMutationAllowed } from "@/lib/db/crm-write-authz";
import { isCrmViewerNarrowed, viewerCanSeeCrmRecord, type CrmViewer } from "@/lib/db/crm-record-scope";
import { crmEntityFromCollection, type CrmEntity } from "@/lib/db/crm-types";
import { ownedMatchesMemberScope } from "@/lib/db/list-crm-postgres";
import { leadMatchesMemberScope, memberLeadScopeWhere } from "@/lib/db/list-leads-postgres";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { crmModuleAllowedServer } from "@/lib/platform/guard-admin-feature";
import type { TenantApiContext } from "@/lib/platform/tenant-api-guard";
import type { Account, Contact, Deal, Lead } from "@/lib/types";
import type { ModuleCapability } from "@/lib/permissions/catalog";

export type CrmDocOp = "read" | "patch" | "upsert" | "delete";

export type CrmDocDenial = { status: number; error: string };

const OP_CAPABILITIES: Record<CrmDocOp, ModuleCapability[]> = {
  read: ["view"],
  patch: ["edit"],
  upsert: ["create", "edit"],
  delete: ["delete"],
};

/** `{ entity, id }` for a top-level CRM row path such as `leads/l-123`. */
export function crmDocTarget(path: string): { entity: CrmEntity; id: string } | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const entity = crmEntityFromCollection(segments[0]!);
  return entity ? { entity, id: segments[1]! } : null;
}

function viewerOf(ctx: TenantApiContext): CrmViewer {
  return { organizationId: ctx.session.organizationId, uid: ctx.session.uid, orgRole: ctx.role };
}

async function canSee(
  viewer: CrmViewer,
  entity: CrmEntity,
  id: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const value = { ...payload, id };
  switch (entity) {
    case "lead":
      return viewerCanSeeCrmRecord(viewer, { entity, value: value as unknown as Lead });
    case "account":
      return viewerCanSeeCrmRecord(viewer, { entity, value: value as unknown as Account });
    case "contact":
      return viewerCanSeeCrmRecord(viewer, { entity, value: value as unknown as Contact });
    case "deal":
      return viewerCanSeeCrmRecord(viewer, { entity, value: value as unknown as Deal });
  }
}

/**
 * Null when allowed. Reads of records outside the viewer's module or scope
 * answer 404 (ids are not confirmed); writes mirror crm-write's answers.
 */
export async function crmDocAccessDenied(
  ctx: TenantApiContext,
  path: string,
  op: CrmDocOp,
  input: { existing: Record<string, unknown> | null; patch?: Record<string, unknown> },
): Promise<CrmDocDenial | null> {
  const target = crmDocTarget(path);
  if (!target) return null;

  if (!(await crmModuleAllowedServer(ctx, target.entity, OP_CAPABILITIES[op]))) {
    return op === "read"
      ? { status: 404, error: "Not found" }
      : { status: 403, error: `Your role does not allow this change (${target.entity}).` };
  }

  if (op === "read") {
    if (!input.existing) return null;
    return (await canSee(viewerOf(ctx), target.entity, target.id, input.existing))
      ? null
      : { status: 404, error: "Not found" };
  }

  const authz = await assertCrmLeadMutationAllowed({
    organizationId: ctx.session.organizationId,
    entity: target.entity,
    id: target.id,
    action: op,
    viewerRole: ctx.role,
    viewerUid: ctx.session.uid,
    patch: input.patch,
  });
  return authz.ok ? null : { status: authz.status, error: authz.error };
}

/** Collection reads: empty without the module, own slice for narrowed members. */
export async function filterCrmDocsForViewer<T extends { path: string; payload: Record<string, unknown> }>(
  ctx: TenantApiContext,
  collectionRoot: string,
  docs: T[],
): Promise<T[]> {
  const entity = crmEntityFromCollection(collectionRoot);
  if (!entity) return docs;
  if (!(await crmModuleAllowedServer(ctx, entity, ["view"]))) return [];
  const viewer = viewerOf(ctx);
  if (!(await isCrmViewerNarrowed(viewer)) || docs.length === 0) return docs;

  const uid = viewer.uid;
  const idOf = (doc: T) => doc.path.split("/").pop() ?? doc.path;
  if (entity === "lead") {
    return docs.filter((d) => leadMatchesMemberScope({ ...d.payload, id: idOf(d) } as unknown as Lead, uid));
  }
  // One query for the member's visible leads, then the same rules as crm-record-scope.
  const visible = await withOrganizationScope(viewer.organizationId, (tx) =>
    tx.lead.findMany({
      where: { organizationId: viewer.organizationId, ...memberLeadScopeWhere(uid) },
      select: { id: true, accountId: true, contactId: true },
    }),
  );
  const leadIds = new Set(visible.map((l) => l.id));
  const accountIds = new Set(visible.map((l) => l.accountId).filter(Boolean));
  const contactIds = new Set(visible.map((l) => l.contactId).filter(Boolean));
  return docs.filter((d) => {
    const ownerId = typeof d.payload.ownerId === "string" ? d.payload.ownerId : "";
    const ownerManagerIds = Array.isArray(d.payload.ownerManagerIds)
      ? (d.payload.ownerManagerIds as string[])
      : undefined;
    const owned = ownedMatchesMemberScope({ ownerId, ownerManagerIds }, uid);
    if (owned) return true;
    if (entity === "account") return accountIds.has(idOf(d));
    if (entity === "contact") return contactIds.has(idOf(d));
    const leadId = typeof d.payload.leadId === "string" ? d.payload.leadId : "";
    return Boolean(leadId) && leadIds.has(leadId);
  });
}
