/**
 * Server-side CRM audit events (QA 2.5). Lead/deal creation and stage moves
 * are recorded where the write happens (crm-write and server create paths)
 * instead of by a separate best-effort browser call, so changes made through
 * the API, imports or jobs are no longer missing from stage history and the
 * activity-log counters.
 */

import { recordAudit, type AuditEvent } from "@/lib/documents/audit";
import { withAuditActor } from "@/lib/documents/audit-helpers";
import { STAGES_BY_KEY } from "@/lib/constants";
import type { PipelineStage } from "@/lib/types";

export type AuditActor = { uid: string; email?: string | null };

export function stageLabel(stage: string): string {
  return STAGES_BY_KEY[stage as PipelineStage]?.label ?? stage;
}

export async function auditLeadStageChanged(
  actor: AuditActor,
  input: {
    organizationId: string;
    leadId: string;
    leadName?: string;
    prevStage: string;
    nextStage: string;
    isProspect?: boolean;
    channel?: string;
  },
): Promise<void> {
  if (!input.nextStage || input.prevStage === input.nextStage) return;
  const prevLabel = stageLabel(input.prevStage);
  const nextLabel = stageLabel(input.nextStage);
  const tableName = input.isProspect ? "prospects" : "leads";
  await recordAudit(
    withAuditActor(actor, {
      organizationId: input.organizationId,
      actorUid: actor.uid,
      event: "lead.stage_changed",
      operation: "update",
      tableName,
      fieldName: "stage",
      message: `${input.isProspect ? "Prospect" : "Lead"} stage changed from ${prevLabel} to ${nextLabel}`,
      prevValue: prevLabel,
      updatedValue: nextLabel,
      meta: {
        leadId: input.leadId,
        leadName: input.leadName,
        prevStage: input.prevStage,
        nextStage: input.nextStage,
        prevValue: prevLabel,
        updatedValue: nextLabel,
        channel: input.channel,
      },
    }),
  );
}

/**
 * `count` > 1 records one row for a batch (e.g. an import chunk); the
 * activity counters add `meta.count`.
 */
export async function auditLeadCreated(
  actor: AuditActor,
  input: {
    organizationId: string;
    leadId?: string;
    leadName?: string;
    isProspect?: boolean;
    channel?: string;
    source?: string;
    count?: number;
  },
): Promise<void> {
  const tableName = input.isProspect ? "prospects" : "leads";
  const entity = input.isProspect ? "Prospect" : "Lead";
  const count = Math.max(1, Math.floor(input.count ?? 1));
  const message =
    count > 1
      ? `${count} ${entity.toLowerCase()}s created${input.source ? ` (${input.source})` : ""}`
      : `${entity} created${input.leadName ? ` (${input.leadName})` : ""}`;
  await recordAudit(
    withAuditActor(actor, {
      organizationId: input.organizationId,
      actorUid: actor.uid,
      event: "lead.created",
      operation: "create",
      tableName,
      message,
      updatedValue: input.leadName ?? input.leadId ?? String(count),
      meta: {
        leadId: input.leadId,
        leadName: input.leadName,
        channel: input.channel,
        tableName,
        ...(input.source ? { source: input.source } : {}),
        ...(count > 1 ? { count } : {}),
      },
    }),
  );
}

export async function auditDealCreated(
  actor: AuditActor,
  input: { organizationId: string; dealId: string; dealName?: string; leadId?: string; channel?: string },
): Promise<void> {
  await recordAudit(
    withAuditActor(actor, {
      organizationId: input.organizationId,
      actorUid: actor.uid,
      event: "deal.created",
      operation: "create",
      tableName: "deals",
      message: `Deal created (${input.dealName ?? input.dealId})`,
      updatedValue: input.dealName ?? input.dealId,
      meta: { dealId: input.dealId, dealName: input.dealName, leadId: input.leadId, channel: input.channel },
    }),
  );
}

export async function auditDealStageChanged(
  actor: AuditActor,
  input: {
    organizationId: string;
    dealId: string;
    dealName?: string;
    prevStage: string;
    nextStage: string;
    channel?: string;
  },
): Promise<void> {
  if (!input.nextStage || input.prevStage === input.nextStage) return;
  const prevLabel = stageLabel(input.prevStage);
  const nextLabel = stageLabel(input.nextStage);
  const event: AuditEvent =
    input.nextStage === "won" ? "deal.won" : input.nextStage === "lost" ? "deal.lost" : "deal.stage_changed";
  await recordAudit(
    withAuditActor(actor, {
      organizationId: input.organizationId,
      actorUid: actor.uid,
      event,
      operation: "update",
      tableName: "deals",
      fieldName: "stage",
      message:
        event === "deal.won"
          ? "Deal marked won"
          : event === "deal.lost"
            ? "Deal marked lost"
            : `Deal stage changed from ${prevLabel} to ${nextLabel}`,
      prevValue: prevLabel,
      updatedValue: nextLabel,
      meta: {
        dealId: input.dealId,
        dealName: input.dealName,
        prevStage: input.prevStage,
        nextStage: input.nextStage,
        prevValue: prevLabel,
        updatedValue: nextLabel,
        channel: input.channel,
      },
    }),
  );
}
