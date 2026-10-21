import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recordAudit } from "@/lib/documents/audit";
import { withAuditActor } from "@/lib/documents/audit-helpers";
import {
  auditDealCreated,
  auditDealStageChanged,
  auditLeadCreated,
  auditLeadStageChanged,
} from "@/lib/documents/crm-change-audit-server";

const pipelineStageSchema = z.enum([
  "new",
  "viewed",
  "contacted",
  "replied",
  "qualified",
  "discovery",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

const channelSchema = z.string().max(80).optional();

const leadStageBody = z.object({
  event: z.literal("lead.stage_changed"),
  leadId: z.string().min(1).max(120),
  leadName: z.string().max(200).optional(),
  prevStage: pipelineStageSchema,
  nextStage: pipelineStageSchema,
  tableName: z.enum(["leads", "prospects"]).optional(),
  channel: channelSchema,
});

const leadCreatedBody = z.object({
  event: z.literal("lead.created"),
  leadId: z.string().min(1).max(120),
  leadName: z.string().max(200).optional(),
  tableName: z.enum(["leads", "prospects"]).optional(),
  channel: channelSchema,
});

const dealCreatedBody = z.object({
  event: z.literal("deal.created"),
  dealId: z.string().min(1).max(120),
  dealName: z.string().max(200).optional(),
  leadId: z.string().max(120).optional(),
  channel: channelSchema,
});

const dealStageBody = z.object({
  event: z.enum(["deal.stage_changed", "deal.won", "deal.lost"]),
  dealId: z.string().min(1).max(120),
  dealName: z.string().max(200).optional(),
  prevStage: pipelineStageSchema,
  nextStage: pipelineStageSchema,
  channel: channelSchema,
});

const counterLoggedBody = z.object({
  event: z.literal("activity.counter_logged"),
  channel: z.string().min(1).max(80),
  date: z.string().min(1).max(40),
  counters: z.record(z.string(), z.number().int().min(0)),
  profileId: z.string().max(120).optional(),
});

const strategyBody = z.object({
  event: z.enum([
    "strategy.created",
    "strategy.updated",
    "strategy.deleted",
    "strategy.assigned",
    "strategy.pack_imported",
  ]),
  strategyId: z.string().min(1).max(120),
  strategyName: z.string().max(200).optional(),
  action: z.string().max(80).optional(),
  assigneeId: z.string().max(120).optional(),
});

const bodySchema = z.discriminatedUnion("event", [
  leadStageBody,
  leadCreatedBody,
  dealCreatedBody,
  dealStageBody,
  counterLoggedBody,
  strategyBody,
]);

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const orgId = g.ctx.session.organizationId;
  const actorUid = g.ctx.session.uid;

  const actor = { uid: actorUid, email: g.ctx.session.email };

  if (data.event === "lead.stage_changed") {
    const { leadId, leadName, prevStage, nextStage, tableName, channel } = data;
    if (prevStage === nextStage) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    await auditLeadStageChanged(actor, {
      organizationId: orgId,
      leadId,
      leadName,
      prevStage,
      nextStage,
      isProspect: tableName === "prospects",
      channel,
    });
    return NextResponse.json({ ok: true });
  }

  if (data.event === "lead.created") {
    const { leadId, leadName, tableName, channel } = data;
    await auditLeadCreated(actor, {
      organizationId: orgId,
      leadId,
      leadName,
      channel,
      isProspect: tableName === "prospects",
    });
    return NextResponse.json({ ok: true });
  }

  if (data.event === "deal.created") {
    const { dealId, dealName, leadId, channel } = data;
    await auditDealCreated(actor, { organizationId: orgId, dealId, dealName, leadId, channel });
    return NextResponse.json({ ok: true });
  }

  if (
    data.event === "deal.stage_changed" ||
    data.event === "deal.won" ||
    data.event === "deal.lost"
  ) {
    const { dealId, dealName, prevStage, nextStage, channel } = data;
    if (prevStage === nextStage) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    await auditDealStageChanged(actor, {
      organizationId: orgId,
      dealId,
      dealName,
      prevStage,
      nextStage,
      channel,
    });
    return NextResponse.json({ ok: true });
  }

  if (data.event === "activity.counter_logged") {
    const { channel, date, counters, profileId } = data;
    const total = Object.values(counters).reduce((s, n) => s + n, 0);

    await recordAudit(
      withAuditActor(g.ctx.session, {
        organizationId: orgId,
        actorUid,
        event: "activity.counter_logged",
        operation: "create",
        tableName: "activityCounters",
        fieldName: "counters",
        message: `Logged ${total} activity count${total === 1 ? "" : "s"} for ${channel}`,
        updatedValue: JSON.stringify(counters),
        meta: { channel, date, counters, profileId },
      }),
    );
    return NextResponse.json({ ok: true });
  }

  if (
    data.event === "strategy.created" ||
    data.event === "strategy.updated" ||
    data.event === "strategy.deleted" ||
    data.event === "strategy.assigned" ||
    data.event === "strategy.pack_imported"
  ) {
    const { event, strategyId, strategyName, action, assigneeId } = data;
    const name = strategyName ?? strategyId;
    const message =
      event === "strategy.created"
        ? `Strategy created (${name})`
        : event === "strategy.updated"
          ? `Strategy updated (${name})`
          : event === "strategy.deleted"
            ? `Strategy deleted (${name})`
            : event === "strategy.pack_imported"
              ? `Strategy pack imported (${name})`
              : `Strategy assignment ${action ?? "updated"} (${name})`;

    await recordAudit(
      withAuditActor(g.ctx.session, {
        organizationId: orgId,
        actorUid,
        event,
        operation:
          event === "strategy.deleted"
            ? "delete"
            : event === "strategy.created" || event === "strategy.pack_imported"
              ? "create"
              : "update",
        tableName:
          event === "strategy.assigned" ? "strategyAssignments" : "prospectingStrategies",
        message,
        updatedValue: name,
        meta: {
          strategyId,
          ...(strategyName !== undefined ? { strategyName } : {}),
          ...(action !== undefined ? { action } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
        },
      }),
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
}
