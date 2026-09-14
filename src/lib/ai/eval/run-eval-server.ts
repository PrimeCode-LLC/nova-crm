/**
 * Offline eval runner — lab zone only (never creates followups / scheduled emails).
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getOutreachConfig } from "@/lib/ai/outreach-config-server";
import { evaluateSequenceRules, summarizeRuleResults } from "@/lib/ai/eval/rules";
import { judgePairwise } from "@/lib/ai/eval/judge";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { z } from "zod";

const suggestSchema = z.object({
  planSummary: z.string(),
  items: z
    .array(
      z.object({
        title: z.string(),
        channel: z.string().optional(),
        emailSubject: z.string().optional(),
        messageBody: z.string(),
        description: z.string().optional(),
        rationale: z.string().optional(),
        priority: z.string().optional(),
        dueDate: z.string().optional(),
      }),
    )
    .min(1)
    .max(6),
});

function draftTextFromSteps(
  steps: Array<{ subject?: string; body: string }>,
): string {
  return steps
    .map((s, i) => `Step ${i + 1}\nSubject: ${s.subject ?? ""}\n${s.body}`)
    .join("\n\n");
}

async function generateEvalDraft(input: {
  organizationId: string;
  userId: string;
  configId: string;
  systemPrompt: string;
  leadContext: string;
  threadContext: string;
}): Promise<{
  generationId?: string;
  steps: Array<{ stepIndex: number; subject?: string; body: string }>;
}> {
  try {
    const ai = await runAiStructuredFeature({
      organizationId: input.organizationId,
      userId: input.userId,
      feature: "followup_suggest",
      configId: input.configId,
      zone: "lab",
      systemPromptOverride: input.systemPrompt,
      promptVars: {
        context: input.leadContext,
        ragBlock: "(none)",
        userPrompt: "(eval harness)",
        sequenceMode: "full",
        sequenceModeHint: "Full personalized outreach from first touch.",
        channelMix: "email",
        channelMixHint: "Email-only sequence.",
        templateHint: "(none)",
        threadBlock: input.threadContext || "(no prior thread)",
        regenerateBlock: "",
        roleGuidance: "Write concise B2B outbound.",
      },
      schema: suggestSchema,
    });
    return {
      generationId: ai.generationId,
      steps: ai.output.items.map((it, i) => ({
        stepIndex: i,
        subject: it.emailSubject,
        body: it.messageBody,
      })),
    };
  } catch (e) {
    console.warn("[eval] generation failed", input.configId, e);
    return { steps: [{ stepIndex: 0, body: "", subject: "" }] };
  }
}

export async function runOfflineEvalServer(input: {
  organizationId: string;
  configId: string;
  datasetKey?: string;
  userId?: string;
  comparedToConfigId?: string;
}): Promise<{ ok: true; evalRunId: string } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured" };

  const datasetKey = input.datasetKey ?? "golden_v1";
  const config = await getOutreachConfig(input.organizationId, input.configId);
  if (!config) return { ok: false, error: "Config not found" };

  // Default comparison target: current default-zone pointer (if different).
  let comparedToConfigId = input.comparedToConfigId ?? null;
  if (!comparedToConfigId) {
    const pointer = await withOrganizationScope(input.organizationId, async (tx) =>
      tx.outreachZonePointer.findUnique({
        where: {
          organizationId_featureKey_zone: {
            organizationId: input.organizationId,
            featureKey: config.featureKey,
            zone: "default",
          },
        },
      }),
    );
    if (pointer?.configId && pointer.configId !== input.configId) {
      comparedToConfigId = pointer.configId;
    }
  }

  const controlConfig =
    comparedToConfigId && comparedToConfigId !== input.configId
      ? await getOutreachConfig(input.organizationId, comparedToConfigId)
      : null;

  const evalRunId = `erun-${randomUUID()}`;
  const userId = input.userId ?? "system";

  await withOrganizationScope(input.organizationId, async (tx) => {
    await tx.evalRun.create({
      data: {
        id: evalRunId,
        organizationId: input.organizationId,
        configId: input.configId,
        datasetKey,
        status: "running",
        comparedToConfigId: controlConfig?.id ?? null,
        summary: {
          judgeGating: false,
          note: "Judge results are recorded for display; promotion does not gate on judge until calibration >70%.",
        } as Prisma.InputJsonValue,
      },
    });
  });

  try {
    const items = await withOrganizationScope(input.organizationId, async (tx) =>
      tx.evalDatasetItem.findMany({
        where: { organizationId: input.organizationId, datasetKey, active: true },
        take: 50,
      }),
    );

    let passCount = 0;
    let failCount = 0;
    let hallucinationCount = 0;
    let pairwiseWins = 0;
    let pairwiseLosses = 0;
    let pairwiseTies = 0;
    let judgeComparisons = 0;

    for (const item of items) {
      const leadContext = JSON.stringify(item.leadContext);
      const threadContext = item.threadContext ? JSON.stringify(item.threadContext) : "";

      const variant = await generateEvalDraft({
        organizationId: input.organizationId,
        userId,
        configId: input.configId,
        systemPrompt: config.systemPrompt,
        leadContext,
        threadContext,
      });

      const ruleResults = evaluateSequenceRules({
        steps: variant.steps,
        contextText: `${leadContext}\n${threadContext}`,
      });
      const summary = summarizeRuleResults(ruleResults);
      if (summary.passed) passCount += 1;
      else failCount += 1;
      hallucinationCount += summary.hallucinationCount;

      let judgeScores: Record<string, unknown> = {};
      let judgeNotes: string | null = null;

      if (controlConfig) {
        const control = await generateEvalDraft({
          organizationId: input.organizationId,
          userId,
          configId: controlConfig.id,
          systemPrompt: controlConfig.systemPrompt,
          leadContext,
          threadContext,
        });
        const judged = await judgePairwise({
          organizationId: input.organizationId,
          userId,
          leadContext,
          draftLeft: draftTextFromSteps(control.steps),
          draftRight: draftTextFromSteps(variant.steps),
          leftLabel: "control",
          rightLabel: "variant",
        });
        if (judged.ok) {
          judgeComparisons += 1;
          judgeScores = {
            winner: judged.result.winner,
            winnerLabel: judged.winnerLabel,
            swapped: judged.swapped,
            scores: judged.result.scores,
            comparedToConfigId: controlConfig.id,
          };
          judgeNotes = judged.result.rationale;
          if (judged.winnerLabel === "variant") pairwiseWins += 1;
          else if (judged.winnerLabel === "control") pairwiseLosses += 1;
          else pairwiseTies += 1;
        } else {
          judgeScores = { error: judged.error };
          judgeNotes = judged.error;
        }
      }

      await withOrganizationScope(input.organizationId, async (tx) => {
        await tx.evalResult.create({
          data: {
            id: `eres-${randomUUID()}`,
            organizationId: input.organizationId,
            evalRunId,
            datasetItemId: item.id,
            generationId: variant.generationId ?? null,
            ruleFailures: summary.blockFailures.concat(
              summary.warnFailures,
            ) as unknown as Prisma.InputJsonValue,
            judgeScores: judgeScores as Prisma.InputJsonValue,
            judgeNotes,
            passed: summary.passed,
          },
        });
      });
    }

    const judgeWinRate =
      pairwiseWins + pairwiseLosses > 0
        ? pairwiseWins / (pairwiseWins + pairwiseLosses)
        : null;

    await withOrganizationScope(input.organizationId, async (tx) => {
      await tx.evalRun.update({
        where: { id: evalRunId },
        data: {
          status: "completed",
          itemCount: items.length,
          passCount,
          failCount,
          hallucinationCount,
          pairwiseWins: controlConfig ? pairwiseWins : null,
          pairwiseLosses: controlConfig ? pairwiseLosses : null,
          meanJudgeScore: judgeWinRate,
          finishedAt: new Date(),
          summary: {
            passRate: items.length ? passCount / items.length : 0,
            judgeComparisons,
            pairwiseTies,
            judgeWinRate,
            judgeGating: false,
            note: "Judge results are display-only until calibrate-judge agreement >70%.",
          } as Prisma.InputJsonValue,
        },
      });
    });

    return { ok: true, evalRunId };
  } catch (e) {
    await withOrganizationScope(input.organizationId, async (tx) => {
      await tx.evalRun.update({
        where: { id: evalRunId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          summary: {
            error: e instanceof Error ? e.message : String(e),
          } as Prisma.InputJsonValue,
        },
      });
    });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
