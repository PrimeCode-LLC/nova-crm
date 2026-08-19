import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { cleanupProspectImportDetails } from "@/lib/imports/prospect-import-server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";

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
    await cleanupProspectImportDetails({
      db,
      organizationId: guard.ctx.session.organizationId,
      uploaderId: guard.ctx.session.uid,
      jobId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not clean import details." },
      { status: 400 },
    );
  }
}
