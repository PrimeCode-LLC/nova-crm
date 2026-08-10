/**
 * Phase 1.5 — MillionVerifier bulk verify on Cloud Functions (HTTPS worker).
 * App Hosting keeps session auth and proxies when MILLIONVERIFIER_WORKER_URL is set.
 */
import crypto from "crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const MILLION_VERIFIER_MAX_BATCH = 50;
const MILLION_VERIFIER_CONCURRENCY = 5;
const REALTIME_BASE = "https://api.millionverifier.com/api/v3";

type EncryptedBlob = { iv: string; tag: string; value: string };

export type VerifyLeadResult = {
  leadId: string;
  status?: string;
  emailVerified?: boolean;
  email?: string;
  mvResult?: string;
  credits?: number;
  skipped?: boolean;
  error?: string;
};

function db() {
  return getFirestore();
}

function getSecretsKey(): Buffer | null {
  const raw =
    process.env.AI_SECRETS_KEY_BASE64?.trim() ||
    process.env.EMAIL_SECRETS_KEY_BASE64?.trim() ||
    "";
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function decryptValue(payload: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const value = Buffer.from(payload.value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(value), decipher.final()]).toString("utf8");
}

async function getMillionVerifierApiKey(organizationId: string): Promise<string | null> {
  const key = getSecretsKey();
  if (!key) return null;
  const snap = await db()
    .collection("organizations")
    .doc(organizationId)
    .collection("integrationSecrets")
    .doc("millionverifier")
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const blob = data.apiKey as EncryptedBlob | undefined;
  if (!blob?.iv || !blob?.tag || !blob?.value) return null;
  try {
    return decryptValue(blob, key);
  } catch {
    return null;
  }
}

function mapMillionVerifierResult(result: string | null | undefined): {
  emailVerificationStatus: string;
  emailVerified: boolean;
  clearEmailBouncedAt: boolean;
} {
  const normalized = (result ?? "").trim().toLowerCase();
  switch (normalized) {
    case "ok":
      return {
        emailVerificationStatus: "verified",
        emailVerified: true,
        clearEmailBouncedAt: true,
      };
    case "catch_all":
      return {
        emailVerificationStatus: "catch_all",
        emailVerified: false,
        clearEmailBouncedAt: true,
      };
    case "invalid":
    case "disposable":
      return {
        emailVerificationStatus: "bounced",
        emailVerified: false,
        clearEmailBouncedAt: false,
      };
    default:
      return {
        emailVerificationStatus: "not_verified",
        emailVerified: false,
        clearEmailBouncedAt: true,
      };
  }
}

async function verifyEmail(apiKey: string, email: string): Promise<{
  result?: string;
  credits?: number;
}> {
  const params = new URLSearchParams({ api: apiKey, email, timeout: "10" });
  const res = await fetch(`${REALTIME_BASE}/?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  let body: { result?: string; credits?: number; error?: string } = {};
  if (text) {
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(text || res.statusText || "Million Verifier request failed");
    }
  }
  if (!res.ok) {
    throw new Error(body.error?.trim() || text || res.statusText || "Million Verifier request failed");
  }
  if (body.error?.trim()) throw new Error(body.error.trim());
  return body;
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function stampForUpdate(payload: Record<string, unknown>, uid?: string): Record<string, unknown> {
  return {
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
    ...(uid ? { updatedByUid: uid } : {}),
  };
}

export async function verifyLeadsEmailsOnFunctions(input: {
  organizationId: string;
  actorUid: string;
  leadIds: string[];
}): Promise<VerifyLeadResult[]> {
  const apiKey = await getMillionVerifierApiKey(input.organizationId);
  if (!apiKey) {
    return input.leadIds.map((leadId) => ({
      leadId,
      error: "Million Verifier is not connected. Add an API key in Settings → Integrations.",
    }));
  }

  const uniqueIds = [
    ...new Set(
      input.leadIds
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, MILLION_VERIFIER_MAX_BATCH),
    ),
  ];
  if (uniqueIds.length === 0) return [];

  return mapPool(uniqueIds, MILLION_VERIFIER_CONCURRENCY, async (leadId) => {
    try {
      const leadSnap = await db().collection("leads").doc(leadId).get();
      if (!leadSnap.exists) return { leadId, error: "Lead not found", skipped: true };
      const lead = leadSnap.data() as Record<string, unknown>;
      if (lead.organizationId !== input.organizationId) {
        return { leadId, error: "Lead not found", skipped: true };
      }

      const contactId = typeof lead.contactId === "string" ? lead.contactId.trim() : "";
      let email = typeof lead.contactEmail === "string" ? lead.contactEmail.trim() : "";

      if (contactId) {
        const contactSnap = await db().collection("contacts").doc(contactId).get();
        if (contactSnap.exists) {
          const contact = contactSnap.data() as Record<string, unknown>;
          if (contact.organizationId === input.organizationId) {
            const contactEmail = typeof contact.email === "string" ? contact.email.trim() : "";
            if (contactEmail) email = contactEmail;
          }
        }
      }

      if (!email) return { leadId, skipped: true, error: "No company email" };

      let mvResponse: { result?: string; credits?: number };
      try {
        mvResponse = await verifyEmail(apiKey, email);
      } catch (err) {
        return {
          leadId,
          email,
          error: err instanceof Error ? err.message : "Verification request failed",
        };
      }

      const mapped = mapMillionVerifierResult(mvResponse.result);
      const now = new Date().toISOString();

      if (contactId) {
        const contactPatch: Record<string, unknown> = {
          emailVerificationStatus: mapped.emailVerificationStatus,
          emailVerified: mapped.emailVerified,
          emailVerificationSource: "millionverifier",
        };
        if (mapped.emailVerificationStatus === "bounced") {
          contactPatch.emailBouncedAt = now;
        } else if (mapped.clearEmailBouncedAt) {
          contactPatch.emailBouncedAt = FieldValue.delete();
        }
        await db()
          .collection("contacts")
          .doc(contactId)
          .update(stampForUpdate(contactPatch, input.actorUid));
      }

      await db()
        .collection("leads")
        .doc(leadId)
        .update(
          stampForUpdate(
            {
              emailVerified: mapped.emailVerified,
              emailVerificationStatus: mapped.emailVerificationStatus,
              emailVerificationSource: "millionverifier",
            },
            input.actorUid,
          ),
        );

      return {
        leadId,
        email,
        status: mapped.emailVerificationStatus,
        emailVerified: mapped.emailVerified,
        mvResult: mvResponse.result,
        credits: mvResponse.credits,
      };
    } catch (err) {
      return {
        leadId,
        error: err instanceof Error ? err.message : "Verification failed",
      };
    }
  });
}
