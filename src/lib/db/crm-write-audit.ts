/**
 * Audit events for /api/org/crm-write (QA 2.5): compares the row before the
 * write with what was written and records lead/deal creation and stage moves.
 */

import { getDealFromPostgres, getLeadFromPostgres } from "@/lib/db/list-crm-postgres";
import type { CrmEntity } from "@/lib/db/crm-types";
import {
  auditDealCreated,
  auditDealStageChanged,
  auditLeadCreated,
  auditLeadStageChanged,
  type AuditActor,
} from "@/lib/documents/crm-change-audit-server";

export type CrmAuditBefore = { stage?: string; intakeKind?: string; channel?: string; name?: string } | null;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function leadName(row: Record<string, unknown> | null | undefined): string | undefined {
  if (!row) return undefined;
  const contact = str(row.contactName);
  const company = str(row.companyName);
  return contact && company ? `${contact} · ${company}` : contact || company;
}

/** Row as it was before the write (null = does not exist yet). Leads and deals only. */
export async function crmAuditBefore(
  organizationId: string,
  entity: CrmEntity,
  id: string,
): Promise<CrmAuditBefore> {
  if (entity === "lead") {
    const lead = await getLeadFromPostgres(organizationId, id);
    return lead
      ? {
          stage: lead.stage,
          intakeKind: lead.intakeKind,
          channel: lead.channel,
          name: leadName(lead as unknown as Record<string, unknown>),
        }
      : null;
  }
  if (entity === "deal") {
    const deal = await getDealFromPostgres(organizationId, id);
    return deal ? { stage: deal.stage, name: deal.name } : null;
  }
  return null;
}

/** Never throws: audit must not fail a write that already succeeded. */
export async function recordCrmWriteAudit(
  actor: AuditActor,
  input: {
    organizationId: string;
    entity: CrmEntity;
    id: string;
    /** True for upsert / upsert_graph (may create); false for patch. */
    mayCreate: boolean;
    before: CrmAuditBefore;
    written: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { organizationId, entity, id, before, written } = input;
    const nextStage = str(written.stage);
    if (entity === "lead") {
      const isProspect = (str(written.intakeKind) ?? before?.intakeKind) === "prospect";
      const channel = str(written.channel) ?? before?.channel;
      const name = leadName(written) ?? before?.name;
      if (!before && input.mayCreate) {
        await auditLeadCreated(actor, { organizationId, leadId: id, leadName: name, isProspect, channel });
      } else if (before && nextStage && before.stage && nextStage !== before.stage) {
        await auditLeadStageChanged(actor, {
          organizationId,
          leadId: id,
          leadName: name,
          prevStage: before.stage,
          nextStage,
          isProspect,
          channel,
        });
      }
      return;
    }
    if (entity === "deal") {
      const name = str(written.name) ?? before?.name;
      if (!before && input.mayCreate) {
        await auditDealCreated(actor, { organizationId, dealId: id, dealName: name, leadId: str(written.leadId) });
        if (nextStage === "won" || nextStage === "lost") {
          await auditDealStageChanged(actor, { organizationId, dealId: id, dealName: name, prevStage: "new", nextStage });
        }
      } else if (before && nextStage && before.stage && nextStage !== before.stage) {
        await auditDealStageChanged(actor, {
          organizationId,
          dealId: id,
          dealName: name,
          prevStage: before.stage,
          nextStage,
        });
      }
    }
  } catch (err) {
    console.error("[crm-write audit]", input.entity, input.id, err);
  }
}
