import { generateText, Output, type LanguageModelUsage } from "ai";
import type { z } from "zod";
import type { AiFeatureKey } from "@/lib/ai/types";
import {
  canUseAiFeature,
  getAiPromptServer,
  getOrganizationAiSettingsServer,
  resolveFeatureModel,
} from "@/lib/ai/ai-settings-server";
import { resolveLanguageModel } from "@/lib/ai/provider-router";
import { recordAiUsage } from "@/lib/ai/usage-logger";
import { interpolatePrompt } from "@/lib/ai/prompt-defaults";
import type { Role } from "@/lib/types";
import type { OutreachZone } from "@/lib/ai/eval/types";

export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

export class AiForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiForbiddenError";
  }
}

export type AiStructuredFeatureResult<T> = {
  output: T;
  generationId?: string;
  configId?: string;
};

async function logUsage(
  input: {
    organizationId: string;
    userId: string;
    userDisplayName?: string;
    feature: AiFeatureKey | "rag_index";
    provider: ReturnType<typeof resolveFeatureModel>["provider"];
    model: string;
    usage?: LanguageModelUsage;
    latencyMs: number;
    status: "ok" | "error";
    errorCode?: string;
    filterHash?: string;
    leadId?: string;
  },
) {
  await recordAiUsage({
    organizationId: input.organizationId,
    userId: input.userId,
    userDisplayName: input.userDisplayName,
    feature: input.feature,
    provider: input.provider,
    model: input.model,
    inputTokens: input.usage?.inputTokens ?? 0,
    outputTokens: input.usage?.outputTokens ?? 0,
    latencyMs: input.latencyMs,
    status: input.status,
    errorCode: input.errorCode,
    filterHash: input.filterHash,
    leadId: input.leadId,
  });
}

async function maybeRecordGeneration(input: {
  organizationId: string;
  userId: string;
  feature: AiFeatureKey;
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  output: unknown;
  usage?: LanguageModelUsage;
  latencyMs: number;
  status: "ok" | "error";
  errorCode?: string;
  leadId?: string;
  configId?: string;
  zone?: OutreachZone | "production";
}): Promise<string | undefined> {
  if (!input.configId) return undefined;
  try {
    const { recordAiGeneration } = await import("@/lib/ai/eval/generation-server");
    const recorded = await recordAiGeneration({
      organizationId: input.organizationId,
      configId: input.configId,
      featureKey: input.feature,
      zone: input.zone ?? "default",
      leadId: input.leadId,
      userId: input.userId,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      output: input.output,
      inputTokens: input.usage?.inputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      latencyMs: input.latencyMs,
      status: input.status,
      errorCode: input.errorCode,
    });
    return recorded.ok ? recorded.id : undefined;
  } catch (e) {
    console.warn("[ai-generation] record skipped", e);
    return undefined;
  }
}

export async function runAiStructuredFeature<T extends z.ZodType>(input: {
  organizationId: string;
  userId: string;
  userDisplayName?: string;
  roleId?: Role;
  feature: AiFeatureKey;
  promptVars: Record<string, string>;
  schema: T;
  /** When set, used instead of interpolating the org prompt template. */
  userPromptOverride?: string;
  /** When set, used instead of the org system prompt (e.g. review reuses the reply feature's model/limits). */
  systemPromptOverride?: string;
  filterHash?: string;
  leadId?: string;
  /** When set, writes an ai_generations row for provenance. */
  configId?: string;
  zone?: OutreachZone | "production";
}): Promise<AiStructuredFeatureResult<z.infer<T>>> {
  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  if (!canUseAiFeature(settings, input.feature, input.roleId)) {
    throw new AiForbiddenError("AI is disabled or not allowed for your role.");
  }

  const { provider, model } = resolveFeatureModel(settings, input.feature);
  const prompt = await getAiPromptServer(input.organizationId, input.feature);
  const systemPrompt = input.systemPromptOverride ?? prompt.systemPrompt;
  const userPrompt =
    input.userPromptOverride ?? interpolatePrompt(prompt.userPromptTemplate, input.promptVars);

  const started = Date.now();
  try {
    const languageModel = await resolveLanguageModel({
      organizationId: input.organizationId,
      provider,
      model,
    });

    const result = await generateText({
      model: languageModel,
      system: systemPrompt,
      prompt: userPrompt,
      output: Output.object({ schema: input.schema }),
      maxRetries: 0,
    });

    const latencyMs = Date.now() - started;
    await logUsage({
      organizationId: input.organizationId,
      userId: input.userId,
      userDisplayName: input.userDisplayName,
      feature: input.feature,
      provider,
      model,
      usage: result.usage,
      latencyMs,
      status: "ok",
      filterHash: input.filterHash,
      leadId: input.leadId,
    });

    const generationId = await maybeRecordGeneration({
      organizationId: input.organizationId,
      userId: input.userId,
      feature: input.feature,
      provider,
      model,
      systemPrompt,
      userPrompt,
      output: result.output,
      usage: result.usage,
      latencyMs,
      status: "ok",
      leadId: input.leadId,
      configId: input.configId,
      zone: input.zone,
    });

    return {
      output: result.output as z.infer<T>,
      generationId,
      configId: input.configId,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    await logUsage({
      organizationId: input.organizationId,
      userId: input.userId,
      userDisplayName: input.userDisplayName,
      feature: input.feature,
      provider,
      model,
      latencyMs,
      status: "error",
      errorCode: e instanceof Error ? e.name : "unknown",
      filterHash: input.filterHash,
      leadId: input.leadId,
    });
    await maybeRecordGeneration({
      organizationId: input.organizationId,
      userId: input.userId,
      feature: input.feature,
      provider,
      model,
      systemPrompt,
      userPrompt,
      output: {},
      latencyMs,
      status: "error",
      errorCode: e instanceof Error ? e.name : "unknown",
      leadId: input.leadId,
      configId: input.configId,
      zone: input.zone,
    });
    throw e;
  }
}

export async function runAiTextFeature(input: {
  organizationId: string;
  userId: string;
  userDisplayName?: string;
  roleId?: Role;
  feature: AiFeatureKey;
  promptVars: Record<string, string>;
  /** When set, used instead of interpolating the org prompt template (e.g. email improve mode). */
  userPromptOverride?: string;
  filterHash?: string;
  leadId?: string;
}): Promise<string> {
  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  if (!canUseAiFeature(settings, input.feature, input.roleId)) {
    throw new AiForbiddenError("AI is disabled or not allowed for your role.");
  }

  const { provider, model } = resolveFeatureModel(settings, input.feature);
  const prompt = await getAiPromptServer(input.organizationId, input.feature);
  const userPrompt =
    input.userPromptOverride ?? interpolatePrompt(prompt.userPromptTemplate, input.promptVars);

  const started = Date.now();
  try {
    const languageModel = await resolveLanguageModel({
      organizationId: input.organizationId,
      provider,
      model,
    });

    const result = await generateText({
      model: languageModel,
      system: prompt.systemPrompt,
      prompt: userPrompt,
      maxRetries: 0,
    });

    await logUsage({
      organizationId: input.organizationId,
      userId: input.userId,
      userDisplayName: input.userDisplayName,
      feature: input.feature,
      provider,
      model,
      usage: result.usage,
      latencyMs: Date.now() - started,
      status: "ok",
      filterHash: input.filterHash,
      leadId: input.leadId,
    });

    return result.text;
  } catch (e) {
    await logUsage({
      organizationId: input.organizationId,
      userId: input.userId,
      userDisplayName: input.userDisplayName,
      feature: input.feature,
      provider,
      model,
      latencyMs: Date.now() - started,
      status: "error",
      errorCode: e instanceof Error ? e.name : "unknown",
      filterHash: input.filterHash,
      leadId: input.leadId,
    });
    throw e;
  }
}

export async function assertAiEnabled(
  organizationId: string,
  feature: AiFeatureKey,
  roleId?: Role,
): Promise<void> {
  const settings = await getOrganizationAiSettingsServer(organizationId);
  if (!canUseAiFeature(settings, feature, roleId)) {
    throw new AiForbiddenError("AI is disabled or not allowed for your role.");
  }
  const { provider } = resolveFeatureModel(settings, feature);
  const { getAiProviderKeyServer } = await import("@/lib/ai/ai-secrets-server");
  const key = await getAiProviderKeyServer(organizationId, provider);
  if (!key) {
    throw new AiNotConfiguredError(
      `Configure a ${provider} API key in Admin → AI & knowledge.`,
    );
  }
}
