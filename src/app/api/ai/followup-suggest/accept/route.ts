import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  markAiGenerationAccepted,
  upsertSequenceStepProvenance,
} from "@/lib/ai/eval/generation-server";

export const runtime = "nodejs";

const stepSchema = z.object({
  followupId: z.string().min(1),
  stepIndex: z.number().int().min(0),
  channel: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
});

const bodySchema = z.object({
  generationId: z.string().min(1),
  configId: z.string().min(1),
  planId: z.string().min(1),
  leadId: z.string().min(1),
  zone: z.string().optional(),
  experimentId: z.string().optional(),
  variantId: z.string().optional(),
  steps: z.array(stepSchema).min(1).max(20),
});

/**
 * Records sequence_step_provenance after the client persists followups.
 * Non-critical: client should not block sequence creation on failure.
 */
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
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const data = parsed.data;
  const zone = data.zone ?? "default";

  try {
    await markAiGenerationAccepted({
      organizationId: orgId,
      generationId: data.generationId,
    });

    for (const step of data.steps) {
      await upsertSequenceStepProvenance({
        organizationId: orgId,
        followupId: step.followupId,
        planId: data.planId,
        leadId: data.leadId,
        generationId: data.generationId,
        configId: data.configId,
        zone,
        experimentId: data.experimentId,
        variantId: data.variantId,
        stepIndex: step.stepIndex,
        channel: step.channel,
        generatedSubject: step.subject,
        generatedBody: step.body,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("[followup-suggest/accept]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
