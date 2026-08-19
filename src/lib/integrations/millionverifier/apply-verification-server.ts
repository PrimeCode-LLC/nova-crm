import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForUpdate } from "@/lib/documents/tenant-write";
import type { EmailVerificationStatus } from "@/lib/types";
import {
  MillionVerifierApiError,
  verifyEmail,
  type MillionVerifierVerifyResponse,
} from "./client";
import {
  MILLION_VERIFIER_CONCURRENCY,
  MILLION_VERIFIER_MAX_BATCH,
} from "./constants";
import { mapMillionVerifierResult } from "./map-result";
import { getMillionVerifierApiKeyServer } from "./secrets";

export { MILLION_VERIFIER_MAX_BATCH, MILLION_VERIFIER_CONCURRENCY };

export type VerifyLeadResult = {
  leadId: string;
  status?: EmailVerificationStatus;
  emailVerified?: boolean;
  email?: string;
  mvResult?: string;
  credits?: number;
  skipped?: boolean;
  error?: string;
};

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

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function verifyLeadsEmailsServer(input: {
  organizationId: string;
  actorUid: string;
  leadIds: string[];
}): Promise<VerifyLeadResult[]> {
  const db = getAdminDb();
  if (!db) {
    return input.leadIds.map((leadId) => ({
      leadId,
      error: "Database not configured",
    }));
  }

  const apiKey = await getMillionVerifierApiKeyServer(input.organizationId);
  if (!apiKey) {
    return input.leadIds.map((leadId) => ({
      leadId,
      error: "Million Verifier is not connected. Add an API key in Settings → Integrations.",
    }));
  }

  const uniqueIds = [...new Set(input.leadIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  return mapPool(uniqueIds, MILLION_VERIFIER_CONCURRENCY, async (leadId) => {
    try {
      const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
      if (!leadSnap.exists) {
        return { leadId, error: "Lead not found", skipped: true };
      }
      const lead = leadSnap.data() as Record<string, unknown>;
      if (lead.organizationId !== input.organizationId) {
        return { leadId, error: "Lead not found", skipped: true };
      }

      const contactId =
        typeof lead.contactId === "string" ? lead.contactId.trim() : "";
      let email =
        typeof lead.contactEmail === "string" ? lead.contactEmail.trim() : "";

      if (contactId) {
        const contactSnap = await db.collection(COLLECTIONS.contacts).doc(contactId).get();
        if (contactSnap.exists) {
          const contact = contactSnap.data() as Record<string, unknown>;
          if (contact.organizationId === input.organizationId) {
            const contactEmail =
              typeof contact.email === "string" ? contact.email.trim() : "";
            if (contactEmail) email = contactEmail;
          }
        }
      }

      if (!email) {
        return { leadId, skipped: true, error: "No company email" };
      }

      let mvResponse: MillionVerifierVerifyResponse;
      try {
        mvResponse = await verifyEmail({ apiKey, email, timeout: 10 });
      } catch (err) {
        const message =
          err instanceof MillionVerifierApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Verification request failed";
        return { leadId, email, error: message };
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
        await db
          .collection(COLLECTIONS.contacts)
          .doc(contactId)
          .update(stampForUpdate(contactPatch, input.actorUid));
      }

      await db
        .collection(COLLECTIONS.leads)
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
