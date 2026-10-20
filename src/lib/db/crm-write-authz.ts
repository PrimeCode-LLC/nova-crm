/**
 * Server-side CRM mutation authorization (Phase 4).
 * Mirrors client gates in workspace-mode-provider so pagination cannot skip checks.
 */

import {
  getAccountFromPostgres,
  getContactFromPostgres,
  getDealFromPostgres,
  getLeadFromPostgres,
} from "@/lib/db/list-crm-postgres";
import {
  accountVisibleToMember,
  contactVisibleToMember,
  dealVisibleToMember,
  isCrmViewerNarrowed,
  leadVisibleToMember,
} from "@/lib/db/crm-record-scope";
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

const NOT_FOUND = (entity: CrmEntity): CrmWriteAuthzResult => ({
  ok: false,
  status: 404,
  error: `${entity} not found`,
});

/** A member taking an unassigned (open-queue) lead for themselves. */
function isClaimOfOpenLead(lead: Lead, patch: Record<string, unknown>, uid: string): boolean {
  return !lead.ownerId?.trim() && patch.ownerId === uid;
}

/**
 * Record scope for narrowed viewers (QA 1.2). Out-of-scope records answer 404
 * so ids of colleagues' records are not confirmed.
 */
async function assertRecordScope(input: {
  organizationId: string;
  entity: CrmEntity;
  id: string;
  action: "delete" | "patch" | "upsert";
  viewerRole: OrgMemberRole;
  viewerUid: string;
  patch?: Record<string, unknown>;
}): Promise<CrmWriteAuthzResult | null> {
  const viewer = {
    organizationId: input.organizationId,
    uid: input.viewerUid,
    orgRole: input.viewerRole,
  };
  if (!(await isCrmViewerNarrowed(viewer))) return null;
  const isCreate = input.action === "upsert";

  if (input.entity === "lead") {
    const lead = await getLeadFromPostgres(input.organizationId, input.id);
    if (!lead) return isCreate ? null : NOT_FOUND("lead");
    if (leadVisibleToMember(lead, input.viewerUid)) return null;
    if (input.action === "patch" && isClaimOfOpenLead(lead, input.patch ?? {}, input.viewerUid)) {
      return null;
    }
    return NOT_FOUND("lead");
  }
  if (input.entity === "account") {
    const account = await getAccountFromPostgres(input.organizationId, input.id);
    if (!account) return isCreate ? null : NOT_FOUND("account");
    return (await accountVisibleToMember(viewer, account)) ? null : NOT_FOUND("account");
  }
  if (input.entity === "contact") {
    const contact = await getContactFromPostgres(input.organizationId, input.id);
    if (!contact) return isCreate ? null : NOT_FOUND("contact");
    return (await contactVisibleToMember(viewer, contact)) ? null : NOT_FOUND("contact");
  }
  if (input.entity === "deal") {
    const deal = await getDealFromPostgres(input.organizationId, input.id);
    if (!deal) return isCreate ? null : NOT_FOUND("deal");
    return (await dealVisibleToMember(viewer, deal)) ? null : NOT_FOUND("deal");
  }
  return null;
}

export async function assertCrmLeadMutationAllowed(input: {
  organizationId: string;
  entity: CrmEntity;
  id: string;
  action: "delete" | "patch" | "upsert";
  viewerRole: OrgMemberRole;
  /** When set, members are limited to records in their scope (QA 1.2). */
  viewerUid?: string;
  patch?: Record<string, unknown>;
  unset?: string[];
}): Promise<CrmWriteAuthzResult> {
  if (input.action === "delete" && input.entity === "lead" && !roleAtLeast(input.viewerRole, "manager")) {
    return {
      ok: false,
      status: 403,
      error: "Only organization owners, admins, and managers can delete leads.",
    };
  }

  if (input.viewerUid?.trim()) {
    const denied = await assertRecordScope({ ...input, viewerUid: input.viewerUid.trim() });
    if (denied) return denied;
  }

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
