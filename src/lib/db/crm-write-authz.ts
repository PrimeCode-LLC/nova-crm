/**
 * Server-side CRM mutation authorization (Phase 4).
 * Mirrors client gates in workspace-mode-provider so pagination cannot skip checks.
 */

import { getLeadFromPostgres } from "@/lib/db/list-crm-postgres";
import { roleAtLeast } from "@/lib/platform/org-role";
import {
  canEditProspectDerivedLead,
} from "@/lib/prospects/prospect-access";
import type { Lead, OrgMemberRole } from "@/lib/types";
import type { CrmEntity } from "@/lib/db/dual-write-crm";

export type CrmWriteAuthzResult =
  | { ok: true; lead: Lead | null }
  | { ok: false; status: number; error: string };

/** Detect archive / restore / owner reassignment patches that need lead authz. */
export function leadPatchNeedsAuthz(patch: Record<string, unknown>, unset: string[]): boolean {
  if ("ownerId" in patch || "archivedAt" in patch || "archiveReason" in patch) return true;
  if (unset.includes("archivedAt") || unset.includes("archiveReason")) return true;
  if ("intakeKind" in patch) return true;
  return false;
}

export async function assertCrmLeadMutationAllowed(input: {
  organizationId: string;
  entity: CrmEntity;
  id: string;
  action: "delete" | "patch" | "upsert";
  viewerRole: OrgMemberRole;
  patch?: Record<string, unknown>;
  unset?: string[];
}): Promise<CrmWriteAuthzResult> {
  if (input.entity !== "lead") {
    return { ok: true, lead: null };
  }

  if (input.action === "delete") {
    if (!roleAtLeast(input.viewerRole, "manager")) {
      return {
        ok: false,
        status: 403,
        error: "Only organization owners, admins, and managers can delete leads.",
      };
    }
    const lead = await getLeadFromPostgres(input.organizationId, input.id);
    if (!lead) {
      return { ok: false, status: 404, error: "lead not found" };
    }
    return { ok: true, lead };
  }

  if (input.action === "patch") {
    const patch = input.patch ?? {};
    const unset = input.unset ?? [];
    if (!leadPatchNeedsAuthz(patch, unset)) {
      return { ok: true, lead: null };
    }
    const lead = await getLeadFromPostgres(input.organizationId, input.id);
    if (!lead) {
      return { ok: false, status: 404, error: "lead not found" };
    }
    if (!canEditProspectDerivedLead(lead, input.viewerRole)) {
      return {
        ok: false,
        status: 403,
        error: "Only workspace admins can edit this lead.",
      };
    }
    return { ok: true, lead };
  }

  if (input.action === "upsert") {
    // Create: no existing row → allow. Update: treat `doc` like a patch so
    // owner/archive/intakeKind overwrites cannot bypass the patch gate.
    const lead = await getLeadFromPostgres(input.organizationId, input.id);
    if (!lead) {
      return { ok: true, lead: null };
    }
    const patch = input.patch ?? {};
    if (!leadPatchNeedsAuthz(patch, [])) {
      return { ok: true, lead };
    }
    if (!canEditProspectDerivedLead(lead, input.viewerRole)) {
      return {
        ok: false,
        status: 403,
        error: "Only workspace admins can edit this lead.",
      };
    }
    return { ok: true, lead };
  }

  return { ok: true, lead: null };
}
