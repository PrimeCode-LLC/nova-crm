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
  /** True when the caller cancelled before all chunks finished. */
  cancelled?: boolean;
  /** Per-chunk HTTP/network failures (run continues when possible). */
  chunkErrors?: string[];
};

export type VerifyEmailProgress = {
  done: number;
  total: number;
  remaining: number;
  chunkIndex: number;
  totalChunks: number;
  summary: VerifyEmailApiSummary;
  lastChunkResults: VerifyEmailApiResult[];
  chunkError?: string;
};

export type VerifyLeadEmailsClientOptions = {
  /** Hard abort (e.g. dialog unmount). May interrupt the in-flight batch. */
  signal?: AbortSignal;
  /** Soft cancel checked between batches; the current batch still finishes. */
  shouldCancel?: () => boolean;
  onProgress?: (progress: VerifyEmailProgress) => void;
};

export function emptyVerifySummary(): VerifyEmailApiSummary {
  return {
    total: 0,
    verified: 0,
    bounced: 0,
    catchAll: 0,
    notVerified: 0,
    skipped: 0,
    failed: 0,
  };
}

function mergeSummary(
  into: VerifyEmailApiSummary,
  chunk: VerifyEmailApiSummary,
): void {
  into.total += chunk.total;
  into.verified += chunk.verified;
  into.bounced += chunk.bounced;
  into.catchAll += chunk.catchAll;
  into.notVerified += chunk.notVerified;
  into.skipped += chunk.skipped;
  into.failed += chunk.failed;
}

function failedChunkResults(
  leadIds: string[],
  message: string,
): { results: VerifyEmailApiResult[]; summary: VerifyEmailApiSummary } {
  return {
    results: leadIds.map((leadId) => ({ leadId, error: message })),
    summary: {
      total: leadIds.length,
      verified: 0,
      bounced: 0,
      catchAll: 0,
      notVerified: 0,
      skipped: 0,
      failed: leadIds.length,
    },
  };
}

export async function verifyLeadEmailsClient(
  leadIds: string[],
  options?: VerifyLeadEmailsClientOptions,
): Promise<VerifyEmailApiResponse> {
  const unique = [...new Set(leadIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return {
      results: [],
      summary: emptyVerifySummary(),
    };
  }

  const allResults: VerifyEmailApiResult[] = [];
  const summary = emptyVerifySummary();
  const chunkErrors: string[] = [];
  const totalChunks = Math.ceil(unique.length / MILLION_VERIFIER_MAX_BATCH);
  let cancelled = false;

  for (let i = 0; i < unique.length; i += MILLION_VERIFIER_MAX_BATCH) {
    if (options?.signal?.aborted || options?.shouldCancel?.()) {
      cancelled = true;
      break;
    }

    const chunk = unique.slice(i, i + MILLION_VERIFIER_MAX_BATCH);
    const chunkIndex = Math.floor(i / MILLION_VERIFIER_MAX_BATCH) + 1;
    let chunkResults: VerifyEmailApiResult[];
    let chunkSummary: VerifyEmailApiSummary;
    let chunkError: string | undefined;

    try {
      const res = await fetch("/api/integrations/millionverifier/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: chunk }),
        signal: options?.signal,
      });
      const data = (await res.json().catch(() => ({}))) as VerifyEmailApiResponse & {
        error?: string | { formErrors?: string[] };
      };
      if (!res.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : "Email verification failed";
        chunkError = message;
        chunkErrors.push(message);
        ({ results: chunkResults, summary: chunkSummary } = failedChunkResults(
          chunk,
          message,
        ));
      } else {
        chunkResults = data.results ?? [];
        chunkSummary = data.summary ?? emptyVerifySummary();
      }
    } catch (err) {
      if (options?.signal?.aborted) {
        cancelled = true;
        break;
      }
      const message =
        err instanceof Error ? err.message : "Email verification failed";
      chunkError = message;
      chunkErrors.push(message);
      ({ results: chunkResults, summary: chunkSummary } = failedChunkResults(
        chunk,
        message,
      ));
    }

    allResults.push(...chunkResults);
    mergeSummary(summary, chunkSummary);

    const done = allResults.length;
    options?.onProgress?.({
      done,
      total: unique.length,
      remaining: Math.max(0, unique.length - done),
      chunkIndex,
      totalChunks,
      summary: { ...summary },
      lastChunkResults: chunkResults,
      chunkError,
    });
  }

  return {
    results: allResults,
    summary,
    cancelled,
    chunkErrors: chunkErrors.length ? chunkErrors : undefined,
  };
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
