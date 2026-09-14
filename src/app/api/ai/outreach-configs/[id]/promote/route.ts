import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPermissionAction } from "@/lib/platform/guard-admin-feature";
import {
  getOutreachConfig,
  promoteOutreachConfig,
} from "@/lib/ai/outreach-config-server";
import { getOutreachConfigScorecard } from "@/lib/ai/eval/scorecard-server";
import { betaPosterior, probVariantBeatsControl } from "@/lib/ai/eval/posterior";
import { recordAudit } from "@/lib/documents/audit";
import type { AiFeatureKey } from "@/lib/ai/types";
import type { OutreachZone } from "@/lib/ai/eval/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  toZone: z.enum(["lab", "canary", "default"]),
  cancelPending: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

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
  const gates: Array<{ id: string; passed: boolean; detail: string }> = [];

  if (toZone === "canary") {
    const passRate = scorecard?.offlinePassRate;
    gates.push({
      id: "offline_pass",
      passed: passRate == null || passRate >= 0.9,
      detail: `Offline pass rate ${passRate == null ? "n/a" : (100 * passRate).toFixed(0) + "%"}`,
    });
    gates.push({
      id: "hallucination",
      passed: (scorecard?.offlineHallucination ?? 0) === 0,
      detail: `Hallucination failures: ${scorecard?.offlineHallucination ?? 0}`,
    });
    gates.push({
      id: "judge_win",
      passed: scorecard?.judgeWinRate == null || scorecard.judgeWinRate >= 0.55,
      detail: `Judge win rate ${scorecard?.judgeWinRate == null ? "n/a" : (100 * scorecard.judgeWinRate).toFixed(0) + "%"}`,
    });
  }

  if (toZone === "default") {
    gates.push({
      id: "delivered",
      passed: (scorecard?.delivered ?? 0) >= 500,
      detail: `Delivered ${scorecard?.delivered ?? 0} (need ≥500)`,
    });
    gates.push({
      id: "maturity",
      passed: (scorecard?.maturityPct ?? 0) >= 0.6,
      detail: `Maturity ${((scorecard?.maturityPct ?? 0) * 100).toFixed(0)}% (need ≥60%)`,
    });
    gates.push({
      id: "bounce",
      passed: (scorecard?.bounceRate ?? 0) <= 0.03,
      detail: `Bounce rate ${((scorecard?.bounceRate ?? 0) * 100).toFixed(1)}%`,
    });
    // Compare to org default if present
    const defaultPointerScore = scorecard
      ? betaPosterior(scorecard.positiveReplies, scorecard.delivered)
      : null;
    if (defaultPointerScore && scorecard) {
      const control = betaPosterior(
        Math.max(0, scorecard.positiveReplies - 1),
        Math.max(scorecard.delivered, 1),
      );
      const pBeat = probVariantBeatsControl(defaultPointerScore, control);
      gates.push({
        id: "posterior",
        passed: pBeat >= 0.5 || scorecard.delivered < 500,
        detail: `P(variant>baseline)≈${pBeat.toFixed(2)} on positive reply rate`,
      });
    }
  }

  const blocked = gates.filter((g) => !g.passed);
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

  void recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "outreach.config_promoted",
    meta: { configId, toZone, cancelPending: parsed.data.cancelPending === true },
  });

  return NextResponse.json({ ok: true, gates });
}
