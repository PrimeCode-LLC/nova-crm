import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPermissionAction } from "@/lib/platform/guard-admin-feature";
import {
  getOutreachConfig,
  promoteOutreachConfig,
} from "@/lib/ai/outreach-config-server";
import { getOutreachConfigScorecard } from "@/lib/ai/eval/scorecard-server";
import { betaPosterior, probVariantBeatsControl } from "@/lib/ai/eval/posterior";
import {
  evaluateCanaryGates,
  evaluateDefaultGates,
} from "@/lib/ai/eval/promotion-gates";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/documents/audit";
import { cancelLeadOutreachServer } from "@/lib/email/cancel-lead-outreach-server";
import type { AiFeatureKey } from "@/lib/ai/types";
import type { OutreachZone } from "@/lib/ai/eval/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  toZone: z.enum(["lab", "canary", "default"]),
  cancelPending: z.boolean().optional(),
  /** Preview gates only — do not mutate zone pointers. */
  dryRun: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

async function buildGates(input: {
  orgId: string;
  configId: string;
  featureKey: string;
  toZone: OutreachZone;
  scorecard: Awaited<ReturnType<typeof getOutreachConfigScorecard>>;
}) {
  if (input.toZone === "canary") {
    return evaluateCanaryGates(input.scorecard);
  }
  if (input.toZone === "default") {
    const defaultPointer = await withOrganizationScope(input.orgId, async (tx) =>
      tx.outreachZonePointer.findUnique({
        where: {
          organizationId_featureKey_zone: {
            organizationId: input.orgId,
            featureKey: input.featureKey,
            zone: "default",
          },
        },
      }),
    );

    const controlConfigId =
      defaultPointer?.configId && defaultPointer.configId !== input.configId
        ? defaultPointer.configId
        : null;
    const controlScorecard = controlConfigId
      ? await getOutreachConfigScorecard(input.orgId, controlConfigId)
      : null;

    let pBeat: number | null = null;
    if (input.scorecard && controlScorecard) {
      const variant = betaPosterior(
        input.scorecard.positiveReplies,
        input.scorecard.delivered,
      );
      const control = betaPosterior(
        controlScorecard.positiveReplies,
        controlScorecard.delivered,
      );
      pBeat = probVariantBeatsControl(variant, control);
    }

    return evaluateDefaultGates({
      variant: input.scorecard,
      control: controlScorecard,
      controlConfigId,
      pBeat,
    });
  }
  return [];
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await guardPermissionAction("outreach_lab.promote_config", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;

  const { id: configId } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const config = await getOutreachConfig(orgId, configId);
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const toZone = parsed.data.toZone as OutreachZone;
  const scorecard = await getOutreachConfigScorecard(orgId, configId);
  const gates = await buildGates({
    orgId,
    configId,
    featureKey: config.featureKey,
    toZone,
    scorecard,
  });

  const blocked = gates.filter((gate) => !gate.passed);

  if (parsed.data.dryRun) {
    return NextResponse.json({
      ok: blocked.length === 0 || toZone === "lab",
      dryRun: true,
      gates,
      blocked,
    });
  }

  if (blocked.length > 0 && toZone !== "lab") {
    return NextResponse.json(
      { error: "Promotion gates failed", gates, blocked },
      { status: 409 },
    );
  }

  const result = await promoteOutreachConfig({
    organizationId: orgId,
    configId,
    featureKey: config.featureKey as AiFeatureKey,
    toZone,
    updatedBy: g.ctx.session.uid,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  let cancelledLeads = 0;
  if (parsed.data.cancelPending === true) {
    const leadIds = await withOrganizationScope(orgId, async (tx) => {
      const rows = await tx.sequenceStepProvenance.findMany({
        where: {
          organizationId: orgId,
          configId,
          sentBody: null,
        },
        select: { leadId: true },
        take: 500,
      });
      return [
        ...new Set(
          rows
            .map((r) => r.leadId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
    });
    for (const leadId of leadIds) {
      try {
        await cancelLeadOutreachServer({
          organizationId: orgId,
          leadId,
          userId: g.ctx.session.uid,
          reason: `outreach_config_promoted:${toZone}:${configId}`,
        });
        cancelledLeads += 1;
      } catch {
        /* best-effort */
      }
    }
  }

  void recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "outreach.config_promoted",
    meta: {
      configId,
      toZone,
      cancelPending: parsed.data.cancelPending === true,
      cancelledLeads,
    },
  });

  return NextResponse.json({ ok: true, gates, cancelledLeads });
}
