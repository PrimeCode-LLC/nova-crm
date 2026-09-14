/**
 * Seed / list golden eval dataset items for an org.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getGoldenFixtures } from "@/lib/ai/eval/golden-dataset";

export async function listEvalDatasetItems(
  organizationId: string,
  datasetKey = "golden_v1",
) {
  if (!isDatabaseConfigured()) return [];
  return withOrganizationScope(organizationId, async (tx) =>
    tx.evalDatasetItem.findMany({
      where: { organizationId, datasetKey },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        datasetKey: true,
        label: true,
        segment: true,
        active: true,
        createdAt: true,
      },
    }),
  );
}

export async function seedGoldenDataset(organizationId: string): Promise<{
  ok: true;
  upserted: number;
  skipped: number;
}> {
  if (!isDatabaseConfigured()) {
    return { ok: true, upserted: 0, skipped: 0 };
  }
  const fixtures = getGoldenFixtures();
  let upserted = 0;
  let skipped = 0;

  await withOrganizationScope(organizationId, async (tx) => {
    const existing = await tx.evalDatasetItem.count({
      where: { organizationId, datasetKey: "golden_v1", active: true },
    });
    if (existing >= 20) {
      skipped = existing;
      return;
    }
    for (const f of fixtures) {
      await tx.evalDatasetItem.create({
        data: {
          id: `edi-${randomUUID()}`,
          organizationId,
          datasetKey: "golden_v1",
          label: f.label,
          segment: f.segment,
          leadContext: f.leadContext as Prisma.InputJsonValue,
          threadContext: (f.threadContext ?? undefined) as Prisma.InputJsonValue | undefined,
          active: true,
        },
      });
      upserted += 1;
    }
  });

  return { ok: true, upserted, skipped };
}

export async function listEvalRuns(organizationId: string, configId?: string) {
  if (!isDatabaseConfigured()) return [];
  return withOrganizationScope(organizationId, async (tx) =>
    tx.evalRun.findMany({
      where: {
        organizationId,
        ...(configId ? { configId } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
  );
}

export async function getEvalRunDetail(organizationId: string, evalRunId: string) {
  if (!isDatabaseConfigured()) return null;
  return withOrganizationScope(organizationId, async (tx) => {
    const run = await tx.evalRun.findFirst({
      where: { id: evalRunId, organizationId },
    });
    if (!run) return null;
    const results = await tx.evalResult.findMany({
      where: { organizationId, evalRunId },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return { run, results };
  });
}
