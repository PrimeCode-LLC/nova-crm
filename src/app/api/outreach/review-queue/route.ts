import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { guardPermissionAction } from "@/lib/platform/guard-admin-feature";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

const REVIEW_TAGS = [
  "generic",
  "wrong_angle",
  "too_long",
  "hallucinated",
  "weak_cta",
  "good",
] as const;

const submitSchema = z.object({
  generationId: z.string().min(1),
  thumbs: z.enum(["up", "down"]),
  tag: z.enum(REVIEW_TAGS),
  notes: z.string().max(1000).optional(),
});

export async function GET() {
  const g = await guardPermissionAction("outreach_lab.review_queue", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ items: [] });
  }

  const orgId = g.ctx.session.organizationId;
  const items = await withOrganizationScope(orgId, async (tx) => {
    const gens = await tx.aiGeneration.findMany({
      where: {
        organizationId: orgId,
        featureKey: "followup_suggest",
        status: "ok",
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        configId: true,
        zone: true,
        leadId: true,
        accepted: true,
        output: true,
        createdAt: true,
      },
    });

    // Prefer recent unreviewed: exclude generations that already have an eval_result
    // linked via generationId for review tags (we store review as eval_result with
    // datasetItemId = "review_queue").
    const reviewed = await tx.evalResult.findMany({
      where: {
        organizationId: orgId,
        datasetItemId: "review_queue",
        generationId: { in: gens.map((g) => g.id) },
      },
      select: { generationId: true },
    });
    const reviewedSet = new Set(reviewed.map((r) => r.generationId).filter(Boolean));
    return gens.filter((g) => !reviewedSet.has(g.id)).slice(0, 10);
  });

  return NextResponse.json({ items, tags: REVIEW_TAGS });
}

export async function POST(req: Request) {
  const g = await guardPermissionAction("outreach_lab.review_queue", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = submitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const { generationId, thumbs, tag, notes } = parsed.data;

  const result = await withOrganizationScope(orgId, async (tx) => {
    const gen = await tx.aiGeneration.findFirst({
      where: { id: generationId, organizationId: orgId },
    });
    if (!gen) return { ok: false as const, error: "Generation not found" };

    // Attach review to a synthetic eval run per day so results stay queryable.
    const day = new Date().toISOString().slice(0, 10);
    const evalRunId = `erun-review-${orgId.slice(0, 8)}-${day}`;
    const existing = await tx.evalRun.findFirst({
      where: { id: evalRunId, organizationId: orgId },
    });
    if (!existing) {
      await tx.evalRun.create({
        data: {
          id: evalRunId,
          organizationId: orgId,
          configId: gen.configId,
          datasetKey: "review_queue",
          status: "completed",
          itemCount: 0,
          summary: { kind: "human_review" } as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
    }

    const id = `eres-${randomUUID()}`;
    await tx.evalResult.create({
      data: {
        id,
        organizationId: orgId,
        evalRunId,
        datasetItemId: "review_queue",
        generationId,
        ruleFailures: [] as Prisma.InputJsonValue,
        judgeScores: {
          source: "human_review",
          thumbs,
          tag,
          notes: notes ?? null,
          reviewerUid: g.ctx.session.uid,
        } as Prisma.InputJsonValue,
        judgeNotes: notes ?? `${thumbs}:${tag}`,
        passed: thumbs === "up" || tag === "good",
      },
    });
    return { ok: true as const, id };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
