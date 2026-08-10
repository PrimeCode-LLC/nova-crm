/**
 * P1.5 — App Hosting proxies MillionVerifier bulk verify to Cloud Functions
 * when MILLIONVERIFIER_RUNTIME is not `apphosting` and MILLIONVERIFIER_WORKER_URL is set.
 */
import type { VerifyLeadResult } from "@/lib/integrations/millionverifier/apply-verification-server";

function millionVerifierRuntime(): string {
  return (
    (process.env.MILLIONVERIFIER_RUNTIME ?? "functions").trim().toLowerCase() || "functions"
  );
}

export function millionVerifierWorkerEnabled(): boolean {
  if (millionVerifierRuntime() === "apphosting") return false;
  return Boolean(
    process.env.MILLIONVERIFIER_WORKER_URL?.trim() && process.env.CRON_SECRET?.trim(),
  );
}

export async function verifyLeadsViaWorker(input: {
  organizationId: string;
  actorUid: string;
  leadIds: string[];
}): Promise<{
  results: VerifyLeadResult[];
  summary: {
    total: number;
    verified: number;
    bounced: number;
    catchAll: number;
    notVerified: number;
    skipped: number;
    failed: number;
  };
}> {
  const url = process.env.MILLIONVERIFIER_WORKER_URL!.replace(/\/$/, "");
  const secret = process.env.CRON_SECRET!.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    results?: VerifyLeadResult[];
    summary?: {
      total: number;
      verified: number;
      bounced: number;
      catchAll: number;
      notVerified: number;
      skipped: number;
      failed: number;
    };
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `MillionVerifier worker failed (${res.status})`);
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const summary = body.summary ?? {
    total: results.length,
    verified: results.filter((r) => r.status === "verified").length,
    bounced: results.filter((r) => r.status === "bounced").length,
    catchAll: results.filter((r) => r.status === "catch_all").length,
    notVerified: results.filter((r) => r.status === "not_verified").length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => r.error && !r.skipped && !r.status).length,
  };
  return { results, summary };
}
