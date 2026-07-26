import { z } from "zod";
import {
  extensionOptionsResponse,
  guardExtensionApi,
} from "@/lib/extension/auth-server";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveFitCheckContextServer } from "@/lib/ai/fit-check-rag";
import { listFitCheckProfileOptionsServer } from "@/lib/firestore/profile-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { recordAudit } from "@/lib/firestore/audit";
import { isAuthDisabled } from "@/lib/auth/flags";
import { demoIntentRadarEvaluateResult } from "@/lib/ai/demo-intent-radar-evaluate";
import {
  computeAdjustedIntentScore,
  intentRadarEvaluateResultSchema,
  normalizeIntentRadarEvaluateResult,
  type IntentRadarEvaluatePayload,
} from "@/lib/ai/intent-radar-evaluate-types";
import type { Role } from "@/lib/types";

const signalSchema = z.object({
  signalId: z.string().min(1).max(160),
  label: z.string().min(1).max(200),
  points: z.number().min(0).max(100),
  reason: z.string().max(500),
  evidenceExcerpt: z.string().max(800).optional(),
});

const bodySchema = z.object({
  page: z.object({
    url: z.string().url().max(4000),
    title: z.string().max(500),
    text: z.string().min(20).max(50000),
    domain: z.string().max(300).optional(),
  }),
  lexicalScore: z.number().min(0).max(100),
  matchedSignals: z.array(signalSchema).min(1).max(40),
  strategyName: z.string().max(200).optional(),
  opportunityLabel: z.string().max(200).optional(),
  demo: z.boolean().optional(),
});

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

function withCors(response: Response, headers: HeadersInit): Response {
  const next = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") next.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}

export async function POST(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON." },
      { status: 400, headers: guarded.headers },
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: guarded.headers },
    );
  }

  if (parsed.data.lexicalScore <= 0) {
    return Response.json(
      { error: "AI evaluate is only available when the lexical score is greater than zero." },
      { status: 400, headers: guarded.headers },
    );
  }

  const { organizationId, uid, name } = guarded.principal;
  const db = getAdminDb();
  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap?.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(organizationId);
  const useDemo = parsed.data.demo === true || isAuthDisabled();
  if (!useDemo && !canUseAiFeature(settings, "intent_radar_evaluate", roleId)) {
    return Response.json(
      {
        error:
          "Intent Radar AI evaluate is not enabled. Enable AI and the Intent Radar evaluate feature for your role in Admin → AI.",
        code: "forbidden",
      },
      { status: 403, headers: guarded.headers },
    );
  }

  const title = parsed.data.page.title || parsed.data.page.domain || "Page scan";
  let result;
  if (useDemo) {
    result = demoIntentRadarEvaluateResult({
      title,
      signals: parsed.data.matchedSignals,
    });
  } else {
    const sourceType = "cold_outbound" as const;
    const profileOptions = await listFitCheckProfileOptionsServer({
      organizationId,
      sourceType,
    });
    const profileId = profileOptions[0]?.id;
    const profileLabel = profileOptions[0]?.displayLabel;
    const query = `${sourceType} ${title} ${parsed.data.matchedSignals
      .map((signal) => signal.label)
      .join(" ")} ${parsed.data.page.text.slice(0, 1500)}`;

    let ragBlock =
      "(No knowledge base chunks retrieved. Score using page text and note gaps.)";
    let ragChunks: { title: string; content: string }[] = [];
    try {
      const rag = await retrieveFitCheckContextServer({
        organizationId,
        query,
        sourceType,
        profileId,
        profileLabel,
      });
      if (rag.ragBlock) ragBlock = rag.ragBlock;
      ragChunks = rag.chunks;
    } catch {
      // Proceed without RAG if embeddings/libraries are unavailable.
    }

    try {
      result = await runAiStructuredFeature({
        organizationId,
        userId: uid,
        userDisplayName: name,
        roleId,
        feature: "intent_radar_evaluate",
        promptVars: {
          title,
          url: parsed.data.page.url,
          lexicalScore: String(parsed.data.lexicalScore),
          strategyName: parsed.data.strategyName || "Unassigned",
          opportunityLabel: parsed.data.opportunityLabel || "None",
          signalsJson: JSON.stringify(
            parsed.data.matchedSignals.map((signal) => ({
              signalId: signal.signalId,
              label: signal.label,
              points: signal.points,
              reason: signal.reason,
              evidenceExcerpt: signal.evidenceExcerpt || "",
            })),
          ),
          pageText: parsed.data.page.text.slice(0, 16000),
          ragBlock,
        },
        schema: intentRadarEvaluateResultSchema,
      });
    } catch (error) {
      return withCors(aiErrorResponse(error), guarded.headers);
    }

    if (result.ragCitations.length === 0 && ragChunks.length > 0) {
      result = {
        ...result,
        ragCitations: ragChunks.slice(0, 4).map((chunk) => ({
          title: chunk.title,
          excerpt: chunk.content.slice(0, 280),
        })),
      };
    }
  }

  const reviewedIds = new Set(result.signalReviews.map((item) => item.signalId));
  for (const signal of parsed.data.matchedSignals) {
    if (reviewedIds.has(signal.signalId)) continue;
    result.signalReviews.push({
      signalId: signal.signalId,
      label: signal.label,
      decision: "uncertain",
      polarity: "neutral",
      reason: "Model omitted this signal; marked uncertain.",
    });
  }

  result = normalizeIntentRadarEvaluateResult(result);

  const adjusted = computeAdjustedIntentScore(parsed.data.matchedSignals, result.signalReviews);
  const payload: IntentRadarEvaluatePayload = {
    evaluatedAt: new Date().toISOString(),
    lexicalScore: parsed.data.lexicalScore,
    ...adjusted,
    result,
  };

  void recordAudit({
    organizationId,
    actorUid: uid,
    event: "feature.intent_radar_evaluate",
    meta: {
      url: parsed.data.page.url,
      title,
      lexicalScore: parsed.data.lexicalScore,
      adjustedIntentScore: payload.adjustedIntentScore,
      fitScore: result.fitScore,
      themeFit: result.scores.themeFit,
      buyingIntent: result.scores.buyingIntent,
      icpDeliverability: result.scores.icpDeliverability,
      combined: result.scores.combined,
      pageType: result.pageType,
      projectStage: result.projectStage,
      verdict: result.verdict,
      demo: useDemo,
    },
  });

  return Response.json({ evaluation: payload }, { headers: guarded.headers });
}
