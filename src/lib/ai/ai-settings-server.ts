import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import {
  DEFAULT_AI_SETTINGS,
  type AiFeatureKey,
  type AiPromptTemplate,
  type OrganizationAiSettings,
} from "@/lib/ai/types";
import { AI_PROMPT_DEFAULTS } from "@/lib/ai/prompt-defaults";
import { getAiProviderKeyFlagsServer } from "@/lib/ai/ai-secrets-server";
import type { Role } from "@/lib/types";

function settingsDoc(orgId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiSettings)
    .doc("default");
}

function promptDoc(orgId: string, featureKey: AiFeatureKey) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiPrompts)
    .doc(featureKey);
}

function mergeSettings(raw: Record<string, unknown> | undefined): OrganizationAiSettings {
  if (!raw) return { ...DEFAULT_AI_SETTINGS };
  const base = { ...DEFAULT_AI_SETTINGS, ...raw } as OrganizationAiSettings;
  base.features = {
    ...DEFAULT_AI_SETTINGS.features,
    ...(raw.features as OrganizationAiSettings["features"] | undefined),
  };
  for (const key of Object.keys(DEFAULT_AI_SETTINGS.features) as AiFeatureKey[]) {
    base.features[key] = {
      ...DEFAULT_AI_SETTINGS.features[key],
      ...base.features[key],
    };
  }
  return base;
}

export async function getOrganizationAiSettingsServer(
  organizationId: string,
): Promise<OrganizationAiSettings> {
  const ref = settingsDoc(organizationId);
  if (!ref) return { ...DEFAULT_AI_SETTINGS };
  const snap = await ref.get();
  return mergeSettings(snap.data() as Record<string, unknown> | undefined);
}

export async function updateOrganizationAiSettingsServer(
  organizationId: string,
  patch: Partial<OrganizationAiSettings>,
): Promise<{ ok: true } | { error: string }> {
  const ref = settingsDoc(organizationId);
  if (!ref) return { error: "Database not configured" };
  const current = await getOrganizationAiSettingsServer(organizationId);
  const next: OrganizationAiSettings = {
    ...current,
    ...patch,
    features: patch.features ? { ...current.features, ...patch.features } : current.features,
    updatedAt: new Date().toISOString(),
  };
  await ref.set(next, { merge: true });
  return { ok: true };
}

export async function getAiSettingsForApiServer(organizationId: string) {
  const settings = await getOrganizationAiSettingsServer(organizationId);
  const keyFlags = await getAiProviderKeyFlagsServer(organizationId);
  return { settings, keyFlags };
}

export async function getAiPromptServer(
  organizationId: string,
  featureKey: AiFeatureKey,
): Promise<AiPromptTemplate> {
  const ref = promptDoc(organizationId, featureKey);
  const defaults = AI_PROMPT_DEFAULTS[featureKey];
  if (!ref) {
    return {
      featureKey,
      systemPrompt: defaults.systemPrompt,
      userPromptTemplate: defaults.userPromptTemplate,
      version: 1,
    };
  }
  const snap = await ref.get();
  if (!snap.exists) {
    return {
      featureKey,
      systemPrompt: defaults.systemPrompt,
      userPromptTemplate: defaults.userPromptTemplate,
      version: 1,
    };
  }
  const data = snap.data() as AiPromptTemplate;
  return {
    featureKey,
    systemPrompt: data.systemPrompt ?? defaults.systemPrompt,
    userPromptTemplate: data.userPromptTemplate ?? defaults.userPromptTemplate,
    version: data.version ?? 1,
    updatedAt: data.updatedAt,
  };
}

export async function upsertAiPromptServer(
  organizationId: string,
  prompt: Pick<AiPromptTemplate, "featureKey" | "systemPrompt" | "userPromptTemplate">,
): Promise<{ ok: true } | { error: string }> {
  const ref = promptDoc(organizationId, prompt.featureKey);
  if (!ref) return { error: "Database not configured" };
  const existing = await getAiPromptServer(organizationId, prompt.featureKey);
  await ref.set({
    ...prompt,
    version: (existing.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true };
}

export function canUseAiFeature(
  settings: OrganizationAiSettings,
  feature: AiFeatureKey,
  roleId: Role | undefined,
): boolean {
  if (!settings.enabled) return false;
  const feat = settings.features[feature];
  if (!feat?.enabled) return false;
  const allowed = feat.allowedRoles;
  if (!allowed?.length || !roleId) return true;
  return allowed.includes(roleId);
}

export function resolveFeatureModel(
  settings: OrganizationAiSettings,
  feature: AiFeatureKey,
): { provider: OrganizationAiSettings["defaultProvider"]; model: string } {
  const feat = settings.features[feature];
  return {
    provider: feat?.provider ?? settings.defaultProvider,
    model: feat?.model ?? settings.defaultModel,
  };
}
