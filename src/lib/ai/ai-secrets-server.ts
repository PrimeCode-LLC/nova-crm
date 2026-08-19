import crypto from "crypto";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import type { AiProvider } from "@/lib/ai/types";

type EncryptedBlob = {
  iv: string;
  tag: string;
  value: string;
};

function getSecretsKey(): Buffer | null {
  const raw =
    process.env.AI_SECRETS_KEY_BASE64?.trim() ??
    process.env.EMAIL_SECRETS_KEY_BASE64?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

function encryptValue(value: string, key: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  };
}

function decryptValue(payload: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const value = Buffer.from(payload.value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(value), decipher.final()]).toString("utf8");
}

function providerSecretsDoc(orgId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiProviderSecrets)
    .doc("default");
}

export async function upsertAiProviderKeysServer(input: {
  organizationId: string;
  keys: Partial<Record<AiProvider, string>>;
}): Promise<{ ok: true } | { error: string }> {
  const key = getSecretsKey();
  if (!key) {
    return {
      error:
        "AI_SECRETS_KEY_BASE64 (or EMAIL_SECRETS_KEY_BASE64) is missing or invalid (must decode to 32 bytes).",
    };
  }
  const ref = providerSecretsDoc(input.organizationId);
  if (!ref) return { error: "Database not configured" };

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const provider of ["openai", "anthropic", "google"] as const) {
    const val = input.keys[provider]?.trim();
    if (val) {
      patch[`${provider}Key`] = encryptValue(val, key);
      patch[`${provider}KeySet`] = true;
    }
  }

  await ref.set(patch, { merge: true });
  return { ok: true };
}

export async function getAiProviderKeyServer(
  organizationId: string,
  provider: AiProvider,
): Promise<string | null> {
  const key = getSecretsKey();
  if (!key) return null;
  const ref = providerSecretsDoc(organizationId);
  if (!ref) return null;
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const blob = data[`${provider}Key`] as EncryptedBlob | undefined;
  if (!blob) return null;
  try {
    return decryptValue(blob, key);
  } catch {
    return null;
  }
}

export async function getAiProviderKeyFlagsServer(
  organizationId: string,
): Promise<{ openai: boolean; anthropic: boolean; google: boolean }> {
  const ref = providerSecretsDoc(organizationId);
  if (!ref) return { openai: false, anthropic: false, google: false };
  const snap = await ref.get();
  if (!snap.exists) return { openai: false, anthropic: false, google: false };
  const data = snap.data() as Record<string, unknown>;
  return {
    openai: Boolean(data.openaiKeySet ?? data.openaiKey),
    anthropic: Boolean(data.anthropicKeySet ?? data.anthropicKey),
    google: Boolean(data.googleKeySet ?? data.googleKey),
  };
}

export function isAiEncryptionConfigured(): boolean {
  return getSecretsKey() !== null;
}
