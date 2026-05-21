import { generateObject, generateText, type LanguageModelUsage } from "ai";
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

export async function runAiStructuredFeature<T extends z.ZodType>(input: {
  organizationId: string;
  userId: string;
  userDisplayName?: string;
  roleId?: Role;
  feature: AiFeatureKey;
  promptVars: Record<string, string>;
  schema: T;
  filterHash?: string;
  leadId?: string;
}): Promise<z.infer<T>> {
  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  if (!canUseAiFeature(settings, input.feature, input.roleId)) {
    throw new AiForbiddenError("AI is disabled or not allowed for your role.");
  }

  const { provider, model } = resolveFeatureModel(settings, input.feature);
  const prompt = await getAiPromptServer(input.organizationId, input.feature);
  const userPrompt = interpolatePrompt(prompt.userPromptTemplate, input.promptVars);

  const started = Date.now();
  try {
    const languageModel = await resolveLanguageModel({
      organizationId: input.organizationId,
      provider,
      model,
    });

    const result = await generateObject({
      model: languageModel,
      system: prompt.systemPrompt,
      prompt: userPrompt,
      schema: input.schema,
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

    return result.object as z.infer<T>;
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

export async function runAiTextFeature(input: {
  organizationId: string;
  userId: string;
  userDisplayName?: string;
  roleId?: Role;
  feature: AiFeatureKey;
  promptVars: Record<string, string>;
  filterHash?: string;
  leadId?: string;
}): Promise<string> {
  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  if (!canUseAiFeature(settings, input.feature, input.roleId)) {
    throw new AiForbiddenError("AI is disabled or not allowed for your role.");
  }

  const { provider, model } = resolveFeatureModel(settings, input.feature);
  const prompt = await getAiPromptServer(input.organizationId, input.feature);
  const userPrompt = interpolatePrompt(prompt.userPromptTemplate, input.promptVars);

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
