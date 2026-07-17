import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getUnsafeLocalImportError } from "@/lib/imports/prospect-import-runtime";
import { cancelProspectImportJob } from "@/lib/imports/prospect-import-server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardAdminFeature("import");
  if (!guard.ok) return guard.response;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Firebase Admin is not configured." }, { status: 503 });
  try {
    const { jobId } = await params;
    const status = await cancelProspectImportJob({
      db,
      organizationId: guard.ctx.session.organizationId,
      uploaderId: guard.ctx.session.uid,
      jobId,
      finalizeImmediately: Boolean(getUnsafeLocalImportError()),
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cancel this import." },
      { status: 400 },
    );
  }
}
