import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import type { OutreachZone } from "@/lib/ai/eval/types";

export function hashPromptContent(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type RecordAiGenerationInput = {
  organizationId: string;
  configId: string;
  featureKey: string;
  zone: OutreachZone | "production";
  leadId?: string;
  userId?: string;
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  contextHash?: string;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "ok" | "error";
  errorCode?: string;
};

export async function recordAiGeneration(
  input: RecordAiGenerationInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured" };
  const organizationId = input.organizationId.trim();
  if (!organizationId || !input.configId.trim()) {
    return { ok: false, error: "organizationId and configId required" };
  }

  try {
    const id = randomUUID();
    await withOrganizationScope(organizationId, async (tx) => {
      await tx.aiGeneration.create({
        data: {
          id,
          organizationId,
          configId: input.configId,
          featureKey: input.featureKey,
          zone: input.zone,
          leadId: input.leadId ?? null,
          userId: input.userId ?? null,
          provider: input.provider,
          model: input.model,
          systemPromptHash: hashPromptContent(input.systemPrompt),
          userPrompt: input.userPrompt,
          contextHash: input.contextHash ?? hashPromptContent(input.userPrompt.slice(0, 500)),
          output: (input.output ?? {}) as Prisma.InputJsonValue,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          latencyMs: input.latencyMs,
          status: input.status,
          errorCode: input.errorCode ?? null,
        },
      });
    });
    return { ok: true, id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn("[ai-generations] record failed", error);
    return { ok: false, error };
  }
}

export async function markAiGenerationAccepted(input: {
  organizationId: string;
  generationId: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await withOrganizationScope(input.organizationId, async (tx) => {
      await tx.aiGeneration.updateMany({
        where: { id: input.generationId, organizationId: input.organizationId },
        data: { accepted: true, acceptedAt: new Date() },
      });
    });
  } catch (e) {
    console.warn("[ai-generations] accept mark failed", e);
  }
}

export async function upsertSequenceStepProvenance(input: {
  organizationId: string;
  followupId: string;
  planId?: string;
  leadId?: string;
  generationId: string;
  configId: string;
  zone: string;
  experimentId?: string;
  variantId?: string;
  stepIndex: number;
  channel?: string;
  generatedSubject?: string;
  generatedBody?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured" };
  try {
    await withOrganizationScope(input.organizationId, async (tx) => {
      await tx.sequenceStepProvenance.upsert({
        where: { followupId: input.followupId },
        create: {
          followupId: input.followupId,
          organizationId: input.organizationId,
          planId: input.planId ?? null,
          leadId: input.leadId ?? null,
          generationId: input.generationId,
          configId: input.configId,
          zone: input.zone,
          experimentId: input.experimentId ?? null,
          variantId: input.variantId ?? null,
          stepIndex: input.stepIndex,
          channel: input.channel ?? null,
          generatedSubject: input.generatedSubject ?? null,
          generatedBody: input.generatedBody ?? null,
        },
        update: {
          generationId: input.generationId,
          configId: input.configId,
          zone: input.zone,
          planId: input.planId ?? null,
          leadId: input.leadId ?? null,
          stepIndex: input.stepIndex,
          channel: input.channel ?? null,
          generatedSubject: input.generatedSubject ?? null,
          generatedBody: input.generatedBody ?? null,
        },
      });
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn("[provenance] upsert failed", error);
    return { ok: false, error };
  }
}

export async function updateProvenanceOnSend(input: {
  organizationId: string;
  followupId: string;
  sentSubject: string;
  sentBody: string;
}): Promise<{
  configId?: string;
  generationId?: string;
  zone?: string;
} | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const { levenshteinDistance } = await import("@/lib/ai/eval/types");
    return await withOrganizationScope(input.organizationId, async (tx) => {
      const existing = await tx.sequenceStepProvenance.findFirst({
        where: { followupId: input.followupId, organizationId: input.organizationId },
      });
      if (!existing) return null;
      const editDistance = levenshteinDistance(existing.generatedBody ?? "", input.sentBody);
      await tx.sequenceStepProvenance.update({
        where: { followupId: input.followupId },
        data: {
          sentSubject: input.sentSubject,
          sentBody: input.sentBody,
          editDistance,
        },
      });
      return {
        configId: existing.configId,
        generationId: existing.generationId,
        zone: existing.zone,
      };
    });
  } catch (e) {
    console.warn("[provenance] send update failed", e);
    return null;
  }
}
