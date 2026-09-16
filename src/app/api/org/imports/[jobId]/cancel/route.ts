import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { cancelProspectImportJob } from "@/lib/imports/prospect-import-server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { isQueueImportChunksV1Enabled } from "@/lib/queue/flags";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardAdminFeature("import");
  if (!guard.ok) return guard.response;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Document store is not configured (DATABASE_URL missing)." }, { status: 503 });
  try {
    const { jobId } = await params;
    const status = await cancelProspectImportJob({
      db,
      organizationId: guard.ctx.session.organizationId,
      uploaderId: guard.ctx.session.uid,
      jobId,
      // Without the import-chunk worker, finalize cancel inline (no BullMQ consumer).
      finalizeImmediately: !isQueueImportChunksV1Enabled(),
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cancel this import." },
      { status: 400 },
    );
  }
}
