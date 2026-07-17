import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getProspectImportJob } from "@/lib/imports/prospect-import-server";
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
  const { jobId } = await params;
  const job = await getProspectImportJob(db, guard.ctx.session.organizationId, jobId);
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  return NextResponse.json({ job });
}
