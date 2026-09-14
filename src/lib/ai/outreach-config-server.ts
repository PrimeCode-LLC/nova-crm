/**
 * Resolve outreach configs and zone pointers for followup_suggest (and related).
 */

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { AI_PROMPT_DEFAULTS } from "@/lib/ai/prompt-defaults";
import {
  getOrganizationAiSettingsServer,
  resolveFeatureModel,
} from "@/lib/ai/ai-settings-server";
import type { AiFeatureKey } from "@/lib/ai/types";
import type { OutreachZone } from "@/lib/ai/eval/types";

function contentHash(systemPrompt: string, userPromptTemplate: string): string {
  return createHash("sha256")
    .update(systemPrompt)
    .update("\0")
    .update(userPromptTemplate)
    .digest("hex");
}

export type ResolvedOutreachConfig = {
  id: string;
  organizationId: string;
  featureKey: string;
  label: string;
  systemPrompt: string;
  userPromptTemplate: string;
  provider: string;
  model: string;
  zone: OutreachZone;
};

/**
 * Resolve the active config for a zone. Seeds a default from AI_PROMPT_DEFAULTS
 * on first resolve when no pointer exists. Org pointer wins over platform prompts
 * (callers should pass system/user from this config into runAiStructuredFeature).
 */
export async function resolveOutreachConfig(
  organizationId: string,
  featureKey: AiFeatureKey,
  zone: OutreachZone = "default",
): Promise<ResolvedOutreachConfig | null> {
  if (!isDatabaseConfigured()) return null;
  const orgId = organizationId.trim();
  if (!orgId) return null;

  const defaults = AI_PROMPT_DEFAULTS[featureKey];
  if (!defaults) return null;

  const settings = await getOrganizationAiSettingsServer(orgId);
  const { provider, model } = resolveFeatureModel(settings, featureKey);

  return withOrganizationScope(orgId, async (tx) => {
    const pointer = await tx.outreachZonePointer.findUnique({
      where: {
        organizationId_featureKey_zone: {
          organizationId: orgId,
          featureKey,
          zone,
        },
      },
    });

    if (pointer) {
      const config = await tx.outreachConfig.findFirst({
        where: { id: pointer.configId, organizationId: orgId },
      });
      if (config) {
        return {
          id: config.id,
          organizationId: config.organizationId,
          featureKey: config.featureKey,
          label: config.label,
          systemPrompt: config.systemPrompt,
          userPromptTemplate: config.userPromptTemplate,
          provider: config.provider,
          model: config.model,
          zone,
        };
      }
    }

    // Seed default config + pointer for this zone.
    const id = `ocfg-${randomUUID()}`;
    const hash = contentHash(defaults.systemPrompt, defaults.userPromptTemplate);
    await tx.outreachConfig.create({
      data: {
        id,
        organizationId: orgId,
        featureKey,
        label: `${featureKey} default`,
        systemPrompt: defaults.systemPrompt,
        userPromptTemplate: defaults.userPromptTemplate,
        contentHash: hash,
        provider,
        model,
        status: zone === "default" ? "active" : "draft",
        ragLibraryIds: [] as Prisma.InputJsonValue,
      },
    });
    await tx.outreachZonePointer.upsert({
      where: {
        organizationId_featureKey_zone: {
          organizationId: orgId,
          featureKey,
          zone,
        },
      },
      create: {
        organizationId: orgId,
        featureKey,
        zone,
        configId: id,
      },
      update: { configId: id, updatedAt: new Date() },
    });

    return {
      id,
      organizationId: orgId,
      featureKey,
      label: `${featureKey} default`,
      systemPrompt: defaults.systemPrompt,
      userPromptTemplate: defaults.userPromptTemplate,
      provider,
      model,
      zone,
    };
  });
}

export async function createOutreachConfig(input: {
  organizationId: string;
  featureKey: AiFeatureKey;
  label: string;
  systemPrompt: string;
  userPromptTemplate: string;
  parentConfigId?: string;
  createdBy?: string;
  notes?: string;
  provider?: string;
  model?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured" };
  try {
    const settings = await getOrganizationAiSettingsServer(input.organizationId);
    const resolved = resolveFeatureModel(settings, input.featureKey);
    const id = `ocfg-${randomUUID()}`;
    await withOrganizationScope(input.organizationId, async (tx) => {
      await tx.outreachConfig.create({
        data: {
          id,
          organizationId: input.organizationId,
          featureKey: input.featureKey,
          label: input.label,
          systemPrompt: input.systemPrompt,
          userPromptTemplate: input.userPromptTemplate,
          contentHash: contentHash(input.systemPrompt, input.userPromptTemplate),
          provider: input.provider ?? resolved.provider,
          model: input.model ?? resolved.model,
          parentConfigId: input.parentConfigId ?? null,
          status: "draft",
          createdBy: input.createdBy ?? null,
          notes: input.notes ?? null,
          ragLibraryIds: [] as Prisma.InputJsonValue,
        },
      });
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function promoteOutreachConfig(input: {
  organizationId: string;
  configId: string;
  featureKey: AiFeatureKey;
  toZone: OutreachZone;
  updatedBy?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured" };
  try {
    await withOrganizationScope(input.organizationId, async (tx) => {
      const config = await tx.outreachConfig.findFirst({
        where: { id: input.configId, organizationId: input.organizationId },
      });
      if (!config) throw new Error("Config not found");

      await tx.outreachZonePointer.upsert({
        where: {
          organizationId_featureKey_zone: {
            organizationId: input.organizationId,
            featureKey: input.featureKey,
            zone: input.toZone,
          },
        },
        create: {
          organizationId: input.organizationId,
          featureKey: input.featureKey,
          zone: input.toZone,
          configId: input.configId,
          updatedBy: input.updatedBy ?? null,
        },
        update: {
          configId: input.configId,
          updatedBy: input.updatedBy ?? null,
          updatedAt: new Date(),
        },
      });

      const status =
        input.toZone === "default"
          ? "active"
          : input.toZone === "canary"
            ? "canary"
            : "lab_passed";
      await tx.outreachConfig.update({
        where: { id: input.configId },
        data: { status },
      });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listOutreachConfigs(organizationId: string, featureKey?: string) {
  if (!isDatabaseConfigured()) return [];
  return withOrganizationScope(organizationId, async (tx) => {
    return tx.outreachConfig.findMany({
      where: {
        organizationId,
        ...(featureKey ? { featureKey } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
}

export async function getOutreachConfig(organizationId: string, configId: string) {
  if (!isDatabaseConfigured()) return null;
  return withOrganizationScope(organizationId, async (tx) => {
    return tx.outreachConfig.findFirst({
      where: { id: configId, organizationId },
    });
  });
}

/** Zone → configId map for a feature (lab | canary | default). */
export async function getZonePointers(
  organizationId: string,
  featureKey: string,
): Promise<Partial<Record<OutreachZone, string>>> {
  if (!isDatabaseConfigured()) return {};
  return withOrganizationScope(organizationId, async (tx) => {
    const rows = await tx.outreachZonePointer.findMany({
      where: { organizationId, featureKey },
    });
    const out: Partial<Record<OutreachZone, string>> = {};
    for (const r of rows) {
      if (r.zone === "lab" || r.zone === "canary" || r.zone === "default") {
        out[r.zone] = r.configId;
      }
    }
    return out;
  });
}

/** Walk parentConfigId chain (newest → oldest), capped. */
export async function getConfigLineage(
  organizationId: string,
  configId: string,
  maxDepth = 12,
): Promise<Array<{ id: string; label: string; parentConfigId: string | null; createdAt: Date }>> {
  if (!isDatabaseConfigured()) return [];
  return withOrganizationScope(organizationId, async (tx) => {
    const chain: Array<{
      id: string;
      label: string;
      parentConfigId: string | null;
      createdAt: Date;
    }> = [];
    let currentId: string | null = configId;
    for (let i = 0; i < maxDepth && currentId; i++) {
      const row: {
        id: string;
        label: string;
        parentConfigId: string | null;
        createdAt: Date;
      } | null = await tx.outreachConfig.findFirst({
        where: { id: currentId, organizationId },
        select: { id: true, label: true, parentConfigId: true, createdAt: true },
      });
      if (!row) break;
      chain.push(row);
      currentId = row.parentConfigId;
    }
    return chain;
  });
}
