import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import {
  DEFAULT_AI_SETTINGS,
  type AiFeatureKey,
  type AiPromptTemplate,
  type OrganizationAiSettings,
} from "@/lib/ai/types";
import { AI_PROMPT_DEFAULTS, promptTemplateIsCurrent } from "@/lib/ai/prompt-defaults";
import { mergeFitCheckKnowledgeConfig } from "@/lib/ai/fit-check-knowledge-types";
import { getAiProviderKeyFlagsServer } from "@/lib/ai/ai-secrets-server";
import type { Role } from "@/lib/types";

function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null) return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => stripUndefinedDeep(v))
      .filter((v) => v !== undefined) as unknown as T;
  }
  if (typeof value === "object") {
    // Preserve special objects as-is (Firestore sentinels, Dates, etc.)
    const proto = Object.getPrototypeOf(value);
    if (proto && proto !== Object.prototype) return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = stripUndefinedDeep(v);
      if (next !== undefined) out[k] = next;
    }
    return out as T;
  }
  return value;
}

function settingsDoc(orgId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiSettings)
    .doc("default");
}

function orgPromptDoc(orgId: string, featureKey: AiFeatureKey) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiPrompts)
    .doc(featureKey);
}

function platformPromptDoc(featureKey: AiFeatureKey) {
  const db = getAdminDb();
  if (!db) return null;
  return db.collection(COLLECTIONS.platformAiPrompts).doc(featureKey);
}

function promptFromSnap(
  featureKey: AiFeatureKey,
  data: AiPromptTemplate | undefined,
): AiPromptTemplate {
  const defaults = AI_PROMPT_DEFAULTS[featureKey];
  if (!data) {
    return {
      featureKey,
      systemPrompt: defaults.systemPrompt,
      userPromptTemplate: defaults.userPromptTemplate,
      version: 1,
    };
  }
  const storedTemplate = data.userPromptTemplate ?? defaults.userPromptTemplate;
  if (!promptTemplateIsCurrent(featureKey, storedTemplate)) {
    return {
      featureKey,
      systemPrompt: defaults.systemPrompt,
      userPromptTemplate: defaults.userPromptTemplate,
      version: data.version ?? 1,
      updatedAt: data.updatedAt,
    };
  }
  return {
    featureKey,
    systemPrompt: data.systemPrompt ?? defaults.systemPrompt,
    userPromptTemplate: storedTemplate,
    version: data.version ?? 1,
    updatedAt: data.updatedAt,
  };
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
  if (raw.fitCheckKnowledge) {
    base.fitCheckKnowledge = mergeFitCheckKnowledgeConfig(
      raw.fitCheckKnowledge as Parameters<typeof mergeFitCheckKnowledgeConfig>[0],
    );
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
  // Firestore rejects `undefined` anywhere inside the document.
  await ref.set(stripUndefinedDeep(next), { merge: true });
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
  const defaults = AI_PROMPT_DEFAULTS[featureKey];

  // Org overrides win (multi-tenant SaaS). Platform is fallback, code defaults last.
  const orgRef = orgPromptDoc(organizationId, featureKey);
  if (orgRef) {
    const snap = await orgRef.get();
    if (snap.exists) {
      return promptFromSnap(featureKey, snap.data() as AiPromptTemplate);
    }
  }

  const platformRef = platformPromptDoc(featureKey);
  if (platformRef) {
    const platformSnap = await platformRef.get();
    if (platformSnap.exists) {
      return promptFromSnap(featureKey, platformSnap.data() as AiPromptTemplate);
    }
  }

  return {
    featureKey,
    systemPrompt: defaults.systemPrompt,
    userPromptTemplate: defaults.userPromptTemplate,
    version: 1,
  };
}

/** Writes org-scoped prompts (multi-tenant safe). */
export async function upsertAiPromptServer(
  organizationId: string,
  prompt: Pick<AiPromptTemplate, "featureKey" | "systemPrompt" | "userPromptTemplate">,
): Promise<{ ok: true } | { error: string }> {
  const orgId = organizationId.trim();
  if (!orgId) return { error: "organizationId required" };
  const ref = orgPromptDoc(orgId, prompt.featureKey);
  if (!ref) return { error: "Database not configured" };
  const existingSnap = await ref.get();
  const existingVersion =
    existingSnap.exists && typeof (existingSnap.data() as AiPromptTemplate)?.version === "number"
      ? ((existingSnap.data() as AiPromptTemplate).version ?? 1)
      : 1;
  await ref.set({
    ...prompt,
    version: existingVersion + 1,
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
