import type { EmailVerificationStatus } from "@/lib/types";
import { MILLION_VERIFIER_MAX_BATCH } from "@/lib/integrations/millionverifier/constants";

export type VerifyEmailApiResult = {
  leadId: string;
  status?: EmailVerificationStatus;
  emailVerified?: boolean;
  email?: string;
  mvResult?: string;
  credits?: number;
  skipped?: boolean;
  error?: string;
};

export type VerifyEmailApiSummary = {
  total: number;
  verified: number;
  bounced: number;
  catchAll: number;
  notVerified: number;
  skipped: number;
  failed: number;
};

export type VerifyEmailApiResponse = {
  results: VerifyEmailApiResult[];
  summary: VerifyEmailApiSummary;
  error?: string;
};

export async function verifyLeadEmailsClient(
  leadIds: string[],
): Promise<VerifyEmailApiResponse> {
  const unique = [...new Set(leadIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return {
      results: [],
      summary: {
        total: 0,
        verified: 0,
        bounced: 0,
        catchAll: 0,
        notVerified: 0,
        skipped: 0,
        failed: 0,
      },
    };
  }

  const allResults: VerifyEmailApiResult[] = [];
  const summary: VerifyEmailApiSummary = {
    total: 0,
    verified: 0,
    bounced: 0,
    catchAll: 0,
    notVerified: 0,
    skipped: 0,
    failed: 0,
  };

  for (let i = 0; i < unique.length; i += MILLION_VERIFIER_MAX_BATCH) {
    const chunk = unique.slice(i, i + MILLION_VERIFIER_MAX_BATCH);
    const res = await fetch("/api/integrations/millionverifier/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: chunk }),
    });
    const data = (await res.json().catch(() => ({}))) as VerifyEmailApiResponse & {
      error?: string | { formErrors?: string[] };
    };
    if (!res.ok) {
      const message =
        typeof data.error === "string"
          ? data.error
          : "Email verification failed";
      throw new Error(message);
    }
    allResults.push(...(data.results ?? []));
    if (data.summary) {
      summary.total += data.summary.total;
      summary.verified += data.summary.verified;
      summary.bounced += data.summary.bounced;
      summary.catchAll += data.summary.catchAll;
      summary.notVerified += data.summary.notVerified;
      summary.skipped += data.summary.skipped;
      summary.failed += data.summary.failed;
    }
  }

  return { results: allResults, summary };
}

export function formatVerifySummary(summary: VerifyEmailApiSummary): string {
  const parts: string[] = [];
  if (summary.verified) parts.push(`${summary.verified} verified`);
  if (summary.bounced) parts.push(`${summary.bounced} invalid`);
  if (summary.catchAll) parts.push(`${summary.catchAll} risky (catch-all)`);
  if (summary.notVerified) parts.push(`${summary.notVerified} unknown`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  return parts.length ? parts.join(", ") : "No emails verified";
}
