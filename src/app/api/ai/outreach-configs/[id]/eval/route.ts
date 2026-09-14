import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPermissionAction } from "@/lib/platform/guard-admin-feature";
import { getQueue, QUEUE_EVAL_RUN } from "@/lib/queue/queues";
import { runOfflineEvalServer } from "@/lib/ai/eval/run-eval-server";

export const runtime = "nodejs";

const bodySchema = z.object({
  datasetKey: z.string().optional(),
  sync: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const g = await guardPermissionAction("outreach_lab.run_eval", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;

  const { id: configId } = await ctx.params;
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* empty body ok */
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;

  if (parsed.data.sync) {
    const result = await runOfflineEvalServer({
      organizationId: orgId,
      configId,
      datasetKey: parsed.data.datasetKey,
      userId: g.ctx.session.uid,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result);
  }

  const queue = getQueue(QUEUE_EVAL_RUN);
  if (!queue) {
    // Fall back to sync when Redis unavailable
    const result = await runOfflineEvalServer({
      organizationId: orgId,
      configId,
      datasetKey: parsed.data.datasetKey,
      userId: g.ctx.session.uid,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result);
  }

  await queue.add(
    "run-eval",
    {
      organizationId: orgId,
      configId,
      datasetKey: parsed.data.datasetKey,
      userId: g.ctx.session.uid,
    },
    { jobId: `eval-${configId}-${Date.now()}` },
  );
  return NextResponse.json({ ok: true, queued: true });
}
