import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { verifyLeadsEmailsServer } from "@/lib/integrations/millionverifier/apply-verification-server";
import { MILLION_VERIFIER_MAX_BATCH } from "@/lib/integrations/millionverifier/constants";
import {
  millionVerifierWorkerEnabled,
  verifyLeadsViaWorker,
} from "@/lib/integrations/millionverifier/millionverifier-worker-client";
import { hasMillionVerifierApiKeyServer } from "@/lib/integrations/millionverifier/secrets";

/** Allow a full 50-email batch at concurrency 5 with MV timeouts up to 10s. */
export const maxDuration = 300;

const postSchema = z
  .object({
    leadIds: z.array(z.string().min(1)).min(1).max(MILLION_VERIFIER_MAX_BATCH),
  })
  .strict();

export async function POST(req: Request) {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const connected = await hasMillionVerifierApiKeyServer(orgId);
  if (!connected) {
    return NextResponse.json(
      {
        error:
          "Million Verifier is not connected. Add an API key in Settings → Integrations.",
      },
      { status: 400 },
    );
  }

  if (millionVerifierWorkerEnabled()) {
    try {
      const { results, summary } = await verifyLeadsViaWorker({
        organizationId: orgId,
        actorUid: g.ctx.session.uid,
        leadIds: parsed.data.leadIds,
      });
      return NextResponse.json({ results, summary });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "MillionVerifier worker failed",
          route: "/api/integrations/millionverifier/verify",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Verification failed" },
        { status: 502 },
      );
    }
  }

  const results = await verifyLeadsEmailsServer({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    leadIds: parsed.data.leadIds,
  });

  const verified = results.filter((r) => r.status === "verified").length;
  const bounced = results.filter((r) => r.status === "bounced").length;
  const catchAll = results.filter((r) => r.status === "catch_all").length;
  const notVerified = results.filter((r) => r.status === "not_verified").length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.error && !r.skipped && !r.status).length;

  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      verified,
      bounced,
      catchAll,
      notVerified,
      skipped,
      failed,
    },
  });
}
