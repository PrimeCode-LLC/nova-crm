import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  guardAdminFeature,
  guardPermissionAction,
} from "@/lib/platform/guard-admin-feature";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import {
  assignLeadsToArms,
  persistAssignments,
  STAGE_MIN_PER_ARM,
} from "@/lib/ai/eval/assignment-server";

export const runtime = "nodejs";

const startSchema = z.object({
  name: z.string().min(1),
  hypothesis: z.string().min(1),
  stage: z.union([z.literal(1), z.literal(2)]).default(1),
  primaryMetric: z.string().default("meanPotentialScore"),
  controlConfigId: z.string().min(1),
  variantConfigId: z.string().min(1),
  leadIds: z.array(z.string().min(1)).min(2).max(50_000),
  /** Escape hatch after reviewing A/A failure — still logs an audit. */
  skipAaGate: z.boolean().optional(),
});

export async function GET(req: Request) {
  const g = await guardAdminFeature("outreach_lab");
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ experiments: [] });
  }

  const orgId = g.ctx.session.organizationId;
  const experiments = await withOrganizationScope(orgId, async (tx) => {
    const rows = await tx.experiment.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const withArms = await Promise.all(
      rows.map(async (exp) => {
        const arms = await tx.experimentArm.findMany({
          where: { organizationId: orgId, experimentId: exp.id },
        });
        const assignmentCount = await tx.experimentAssignment.count({
          where: { organizationId: orgId, experimentId: exp.id },
        });
        const perArm = await Promise.all(
          arms.map(async (arm) => ({
            ...arm,
            assigned: await tx.experimentAssignment.count({
              where: { organizationId: orgId, experimentId: exp.id, armId: arm.id },
            }),
          })),
        );
        const minAssigned =
          perArm.length > 0 ? Math.min(...perArm.map((a) => a.assigned)) : 0;
        const remainingPerArm = Math.max(0, exp.minPerArm - minAssigned);
        return {
          ...exp,
          arms: perArm,
          assignmentCount,
          remainingPerArm,
          stageMinPerArm: STAGE_MIN_PER_ARM[exp.stage as 1 | 2] ?? exp.minPerArm,
        };
      }),
    );
    return withArms;
  });

  return NextResponse.json({ experiments });
}

export async function POST(req: Request) {
  const g = await guardPermissionAction("outreach_lab.start_experiment", {
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
  const parsed = startSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const minPerArm = STAGE_MIN_PER_ARM[parsed.data.stage];
  if (parsed.data.leadIds.length < minPerArm * 2) {
    return NextResponse.json(
      {
        error: `Stage ${parsed.data.stage} needs at least ${minPerArm * 2} leads (${minPerArm}/arm)`,
      },
      { status: 400 },
    );
  }

  const { getAaGateState, assignmentBalanceLooksClean } = await import(
    "@/lib/ai/eval/aa-gate-server"
  );
  const aaGate = await getAaGateState(orgId);
  if (!aaGate.clean && !parsed.data.skipAaGate) {
    return NextResponse.json(
      {
        error:
          "A/A gate not passed. Run `npx tsx scripts/run-aa-test.ts --org=<orgId> --config=<configId>` and ensure it reports clean before starting a live experiment. Pass skipAaGate:true only as an explicit override.",
        aaGate,
      },
      { status: 409 },
    );
  }

  const experimentId = `exp-${randomUUID()}`;
  const armControl = `arm-${randomUUID()}`;
  const armVariant = `arm-${randomUUID()}`;

  const assignments = assignLeadsToArms({
    experimentId,
    leadIds: parsed.data.leadIds,
    arms: [
      {
        id: armControl,
        allocation: 50,
        configId: parsed.data.controlConfigId,
        label: "control",
        isControl: true,
      },
      {
        id: armVariant,
        allocation: 50,
        configId: parsed.data.variantConfigId,
        label: "variant",
      },
    ],
  });

  const armCounts = [
    assignments.filter((a) => a.armId === armControl).length,
    assignments.filter((a) => a.armId === armVariant).length,
  ];
  if (
    !assignmentBalanceLooksClean({
      armCounts,
      totalLeads: parsed.data.leadIds.length,
    })
  ) {
    return NextResponse.json(
      {
        error: "Assignment balance failed in-process A/A check (arm sizes diverge >15%)",
        armCounts,
      },
      { status: 500 },
    );
  }

  await withOrganizationScope(orgId, async (tx) => {
    await tx.experiment.create({
      data: {
        id: experimentId,
        organizationId: orgId,
        name: parsed.data.name,
        hypothesis: parsed.data.hypothesis,
        status: "running",
        primaryMetric: parsed.data.primaryMetric,
        stage: parsed.data.stage,
        minPerArm,
        startedAt: new Date(),
      },
    });
    await tx.experimentArm.createMany({
      data: [
        {
          id: armControl,
          organizationId: orgId,
          experimentId,
          label: "control",
          configId: parsed.data.controlConfigId,
          allocation: 50,
          isControl: true,
        },
        {
          id: armVariant,
          organizationId: orgId,
          experimentId,
          label: "variant",
          configId: parsed.data.variantConfigId,
          allocation: 50,
          isControl: false,
        },
      ],
    });
  });

  const { upserted } = await persistAssignments({
    organizationId: orgId,
    experimentId,
    assignments,
  });

  return NextResponse.json({
    ok: true,
    experimentId,
    assigned: upserted,
    stage: parsed.data.stage,
    minPerArm,
    note: "Schedule both arms in a single bulk batch so mailbox round-robin does not confound results.",
  });
}
