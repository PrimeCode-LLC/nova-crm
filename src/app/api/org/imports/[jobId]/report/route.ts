import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildProspectImportRejectionCsv } from "@/lib/imports/prospect-import-server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardAdminFeature("import");
  if (!guard.ok) return guard.response;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Firebase Admin is not configured." }, { status: 503 });
  try {
    const { jobId } = await params;
    const csv = await buildProspectImportRejectionCsv(
      db,
      guard.ctx.session.organizationId,
      jobId,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="prospect-import-${jobId}-issues.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build the issue report." },
      { status: 400 },
    );
  }
}
