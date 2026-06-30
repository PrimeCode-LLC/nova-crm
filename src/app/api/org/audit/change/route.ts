import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recordAudit, type AuditEvent } from "@/lib/firestore/audit";
import { withAuditActor } from "@/lib/firestore/audit-helpers";
import { STAGES_BY_KEY } from "@/lib/constants";
import type { PipelineStage } from "@/lib/types";

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

const bodySchema = z.discriminatedUnion("event", [
  leadStageBody,
  leadCreatedBody,
  dealCreatedBody,
  dealStageBody,
  counterLoggedBody,
]);

function stageLabel(stage: PipelineStage): string {
  return STAGES_BY_KEY[stage]?.label ?? stage;
}

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

  if (data.event === "lead.stage_changed") {
    const { leadId, leadName, prevStage, nextStage, tableName, channel } = data;
    if (prevStage === nextStage) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    const prevLabel = stageLabel(prevStage);
    const nextLabel = stageLabel(nextStage);
    const resolvedTable = tableName ?? "leads";

    await recordAudit(
      withAuditActor(g.ctx.session, {
        organizationId: orgId,
        actorUid,
        event: "lead.stage_changed",
        operation: "update",
        tableName: resolvedTable,
        fieldName: "stage",
        message: `${resolvedTable === "prospects" ? "Prospect" : "Lead"} stage changed from ${prevLabel} to ${nextLabel}`,
        prevValue: prevLabel,
        updatedValue: nextLabel,
        meta: {
          leadId,
          leadName,
          prevStage,
          nextStage,
          prevValue: prevLabel,
          updatedValue: nextLabel,
          channel,
        },
      }),
    );
    return NextResponse.json({ ok: true });
  }

  if (data.event === "lead.created") {
    const { leadId, leadName, tableName, channel } = data;
    const resolvedTable = tableName ?? "leads";
    const entity = resolvedTable === "prospects" ? "Prospect" : "Lead";
    const nameSuffix = leadName ? ` (${leadName})` : "";

    await recordAudit(
      withAuditActor(g.ctx.session, {
        organizationId: orgId,
        actorUid,
        event: "lead.created",
        operation: "create",
        tableName: resolvedTable,
        message: `${entity} created${nameSuffix}`,
        updatedValue: leadName ?? leadId,
        meta: { leadId, leadName, channel, tableName: resolvedTable },
      }),
    );
    return NextResponse.json({ ok: true });
  }

  if (data.event === "deal.created") {
    const { dealId, dealName, leadId, channel } = data;
    await recordAudit(
      withAuditActor(g.ctx.session, {
        organizationId: orgId,
        actorUid,
        event: "deal.created",
        operation: "create",
        tableName: "deals",
        message: `Deal created (${dealName ?? dealId})`,
        updatedValue: dealName ?? dealId,
        meta: { dealId, dealName, leadId, channel },
      }),
    );
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
    const prevLabel = stageLabel(prevStage);
    const nextLabel = stageLabel(nextStage);
    const event = data.event as AuditEvent;

    await recordAudit(
      withAuditActor(g.ctx.session, {
        organizationId: orgId,
        actorUid,
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
          dealId,
          dealName,
          prevStage,
          nextStage,
          prevValue: prevLabel,
          updatedValue: nextLabel,
          channel,
        },
      }),
    );
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

  return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
}
