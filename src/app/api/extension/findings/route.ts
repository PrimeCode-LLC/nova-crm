import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import {
  extensionOptionsResponse,
  guardExtensionApi,
} from "@/lib/extension/auth-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  createScraperRawItemServer,
  findRawItemByDedupeKeyServer,
} from "@/lib/scrapers/raw-items-server";
import { promoteRawItemToProspectServer } from "@/lib/scrapers/promote-server";
import { recordAudit } from "@/lib/firestore/audit";
import {
  StrategyAttributionError,
  validateExtensionStrategyAttribution,
  type ValidatedExtensionStrategyAttribution,
} from "@/lib/extension/strategy-attribution-server";

const strategySchema = z.object({
  strategyId: z.string().min(1).max(160),
  strategyName: z.string().min(1).max(200),
  strategyVersion: z.number().int().min(1),
  strategyAssignmentId: z.string().min(1).max(160),
  personaId: z.string().max(160).optional(),
  score: z.number().min(0).max(100),
  matchedSignalIds: z.array(z.string().max(160)).max(100),
  selectionMode: z.enum(["auto", "manual"]).optional(),
});

const bodySchema = z.object({
  action: z.enum(["intake", "prospect", "attach"]),
  leadId: z.string().max(160).optional(),
  page: z.object({
    url: z.string().url().max(4000),
    title: z.string().max(500),
    text: z.string().min(1).max(50000),
    domain: z.string().max(300).optional(),
  }),
  quality: z.object({
    score: z.number().min(0).max(100),
    matchedSignalIds: z.array(z.string().max(160)).max(100),
    primaryOpportunityId: z.string().max(160).optional(),
    primaryOpportunityLabel: z.string().max(200).optional(),
  }),
  strategy: strategySchema.optional(),
});

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

function dedupeKey(organizationId: string, url: string): string {
  return `extension:${crypto
    .createHash("sha256")
    .update(`${organizationId}:${url}`)
    .digest("hex")}`;
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
  if (parsed.data.action === "attach" && !parsed.data.leadId) {
    return Response.json(
      { error: "leadId is required when attaching a finding." },
      { status: 400, headers: guarded.headers },
    );
  }

  const db = getAdminDb();
  if (!db) {
    return Response.json(
      { error: "Database not configured." },
      { status: 503, headers: guarded.headers },
    );
  }
  const { organizationId, uid } = guarded.principal;
  let strategy: ValidatedExtensionStrategyAttribution | undefined;
  try {
    strategy = await validateExtensionStrategyAttribution({
      db,
      organizationId,
      userId: uid,
      strategy: parsed.data.strategy,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "The selected strategy is not available.",
      },
      {
        status: error instanceof StrategyAttributionError ? 400 : 500,
        headers: guarded.headers,
      },
    );
  }
  const findingId = crypto.randomUUID();
  const finding = {
    organizationId,
    userId: uid,
    action: parsed.data.action,
    page: parsed.data.page,
    quality: parsed.data.quality,
    strategy: strategy ?? null,
    leadId: parsed.data.leadId ?? null,
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection(COLLECTIONS.extensionFindings).doc(findingId).set(finding);
  void recordAudit({
    organizationId,
    actorUid: uid,
    actorEmail: guarded.principal.email,
    event: "extension.finding_saved",
    meta: {
      findingId,
      action: parsed.data.action,
      url: parsed.data.page.url,
      strategyId: strategy?.strategyId,
    },
  });

  if (parsed.data.action === "attach") {
    const leadRef = db.collection(COLLECTIONS.leads).doc(parsed.data.leadId!);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists || leadSnap.data()?.organizationId !== organizationId) {
      return Response.json(
        { error: "Prospect not found." },
        { status: 404, headers: guarded.headers },
      );
    }
    const priorNotes =
      typeof leadSnap.data()?.notes === "string" ? leadSnap.data()!.notes : "";
    const evidenceNote = [
      priorNotes,
      "",
      `Intent Radar: ${parsed.data.page.title}`,
      `Source: ${parsed.data.page.url}`,
      `Match: ${parsed.data.quality.score}/100`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 12000);
    await leadRef.set(
      {
        notes: evidenceNote,
        qualityScore: parsed.data.quality.score,
        qualityMatchedSignalIds: parsed.data.quality.matchedSignalIds,
        qualityScoredAt: new Date().toISOString(),
        primaryOpportunityId: parsed.data.quality.primaryOpportunityId ?? null,
        primaryOpportunityLabel: parsed.data.quality.primaryOpportunityLabel ?? null,
        strategyId: strategy?.strategyId ?? null,
        strategyAssignmentId: strategy?.strategyAssignmentId ?? null,
        strategyVersion: strategy?.strategyVersion ?? null,
        personaId: strategy?.personaId ?? null,
        updatedAt: new Date().toISOString(),
        extensions: {
          ...(leadSnap.data()?.extensions ?? {}),
          intentRadar: {
            findingId,
            url: parsed.data.page.url,
            capturedAt: new Date().toISOString(),
          },
        },
      },
      { merge: true },
    );
    return Response.json(
      { ok: true, findingId, leadId: parsed.data.leadId, duplicate: false },
      { headers: guarded.headers },
    );
  }

  const key = dedupeKey(organizationId, parsed.data.page.url);
  let item = await findRawItemByDedupeKeyServer(organizationId, key);
  const duplicate = Boolean(item);
  if (!item) {
    const created = await createScraperRawItemServer(organizationId, {
      feedId: "nova-intent-radar",
      feedName: "Nova Intent Radar",
      platform: "browser",
      category: parsed.data.quality.primaryOpportunityId ?? "opportunity",
      dedupeKey: key,
      guid: key,
      link: parsed.data.page.url,
      title: parsed.data.page.title || parsed.data.page.domain || "Browser finding",
      content: parsed.data.page.text,
      contentSnippet: parsed.data.page.text.slice(0, 4000),
      creator: guarded.principal.name ?? guarded.principal.email,
      publishedAt: new Date().toISOString(),
    });
    if ("error" in created) {
      return Response.json(
        { error: created.error === "duplicate" ? "Finding already exists." : created.error },
        { status: created.error === "duplicate" ? 409 : 500, headers: guarded.headers },
      );
    }
    item = created.item;
  }

  if (parsed.data.action === "intake") {
    return Response.json(
      { ok: true, findingId, itemId: item.id, duplicate },
      { headers: guarded.headers },
    );
  }

  const promoted = await promoteRawItemToProspectServer({
    organizationId,
    itemId: item.id,
    userId: uid,
    ownerId: uid,
    scraperId: uid,
  });
  if ("error" in promoted) {
    return Response.json(
      { error: promoted.error },
      { status: 400, headers: guarded.headers },
    );
  }
  await db.collection(COLLECTIONS.leads).doc(promoted.leadId).set(
    {
      strategyId: strategy?.strategyId ?? null,
      strategyAssignmentId: strategy?.strategyAssignmentId ?? null,
      strategyVersion: strategy?.strategyVersion ?? null,
      personaId: strategy?.personaId ?? null,
      extensions: {
        ...(promoted.lead.extensions ?? {}),
        intentRadar: {
          findingId,
          url: parsed.data.page.url,
          capturedAt: new Date().toISOString(),
        },
      },
    },
    { merge: true },
  );
  return Response.json(
    { ok: true, findingId, itemId: item.id, leadId: promoted.leadId, duplicate },
    { headers: guarded.headers },
  );
}
