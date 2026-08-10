/**
 * P1.5 — HTTPS MillionVerifier worker (Bearer CRON_SECRET).
 */
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { verifyLeadsEmailsOnFunctions } from "./millionVerifierVerify";

const cronSecret = defineSecret("CRON_SECRET");
const emailSecretsKey = defineSecret("EMAIL_SECRETS_KEY_BASE64");

export const verifyMillionVerifierLeads = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [cronSecret, emailSecretsKey],
    maxInstances: 3,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const secret = cronSecret.value()?.trim();
    const auth = String(req.get("authorization") ?? "");
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const headerSecret = String(req.get("x-cron-secret") ?? "").trim();
    if (!secret || (bearer !== secret && headerSecret !== secret)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    process.env.EMAIL_SECRETS_KEY_BASE64 = emailSecretsKey.value();

    const body = (req.body ?? {}) as {
      organizationId?: string;
      actorUid?: string;
      leadIds?: string[];
    };
    const organizationId =
      typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    const actorUid = typeof body.actorUid === "string" ? body.actorUid.trim() : "";
    const leadIds = Array.isArray(body.leadIds)
      ? body.leadIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];

    if (!organizationId || !actorUid || leadIds.length === 0) {
      res.status(400).json({ error: "organizationId, actorUid, and leadIds are required" });
      return;
    }

    try {
      const results = await verifyLeadsEmailsOnFunctions({
        organizationId,
        actorUid,
        leadIds,
      });
      const verified = results.filter((r) => r.status === "verified").length;
      const bounced = results.filter((r) => r.status === "bounced").length;
      const catchAll = results.filter((r) => r.status === "catch_all").length;
      const notVerified = results.filter((r) => r.status === "not_verified").length;
      const skipped = results.filter((r) => r.skipped).length;
      const failed = results.filter((r) => r.error && !r.skipped && !r.status).length;
      res.json({
        ok: true,
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
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Verification failed",
      });
    }
  },
);
