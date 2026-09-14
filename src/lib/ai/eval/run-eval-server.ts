/**
 * Offline eval runner — lab zone only (never creates followups / scheduled emails).
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getOutreachConfig } from "@/lib/ai/outreach-config-server";
import { evaluateSequenceRules, summarizeRuleResults } from "@/lib/ai/eval/rules";
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

  const evalRunId = `erun-${randomUUID()}`;

  await withOrganizationScope(input.organizationId, async (tx) => {
    await tx.evalRun.create({
      data: {
        id: evalRunId,
        organizationId: input.organizationId,
        configId: input.configId,
        datasetKey,
        status: "running",
        comparedToConfigId: input.comparedToConfigId ?? null,
        summary: {} as Prisma.InputJsonValue,
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

    for (const item of items) {
      const leadContext = JSON.stringify(item.leadContext);
      const threadContext = item.threadContext ? JSON.stringify(item.threadContext) : "";
      let generationId: string | undefined;
      let steps: Array<{ stepIndex: number; subject?: string; body: string }> = [];

      try {
        const ai = await runAiStructuredFeature({
          organizationId: input.organizationId,
          userId: input.userId ?? "system",
          feature: "followup_suggest",
          configId: input.configId,
          zone: "lab",
          systemPromptOverride: config.systemPrompt,
          promptVars: {
            context: leadContext,
            ragBlock: "(none)",
            userPrompt: "(eval harness)",
            sequenceMode: "full",
            sequenceModeHint: "Full personalized outreach from first touch.",
            channelMix: "email",
            channelMixHint: "Email-only sequence.",
            templateHint: "(none)",
            threadBlock: threadContext || "(no prior thread)",
            regenerateBlock: "",
            roleGuidance: "Write concise B2B outbound.",
          },
          schema: suggestSchema,
        });
        generationId = ai.generationId;
        steps = ai.output.items.map((it, i) => ({
          stepIndex: i,
          subject: it.emailSubject,
          body: it.messageBody,
        }));
      } catch (e) {
        steps = [{ stepIndex: 0, body: "", subject: "" }];
        console.warn("[eval] generation failed", item.id, e);
      }

      const ruleResults = evaluateSequenceRules({
        steps,
        contextText: `${leadContext}\n${threadContext}`,
      });
      const summary = summarizeRuleResults(ruleResults);
      if (summary.passed) passCount += 1;
      else failCount += 1;
      hallucinationCount += summary.hallucinationCount;

      await withOrganizationScope(input.organizationId, async (tx) => {
        await tx.evalResult.create({
          data: {
            id: `eres-${randomUUID()}`,
            organizationId: input.organizationId,
            evalRunId,
            datasetItemId: item.id,
            generationId: generationId ?? null,
            ruleFailures: summary.blockFailures.concat(summary.warnFailures) as unknown as Prisma.InputJsonValue,
            judgeScores: {} as Prisma.InputJsonValue,
            passed: summary.passed,
          },
        });
      });
    }

    await withOrganizationScope(input.organizationId, async (tx) => {
      await tx.evalRun.update({
        where: { id: evalRunId },
        data: {
          status: "completed",
          itemCount: items.length,
          passCount,
          failCount,
          hallucinationCount,
          finishedAt: new Date(),
          summary: {
            passRate: items.length ? passCount / items.length : 0,
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
