import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { parseProspectImportFile } from "@/lib/imports/prospect-import-parse";
import { getUnsafeLocalImportError } from "@/lib/imports/prospect-import-runtime";
import { PROSPECT_IMPORT_MAX_BYTES } from "@/lib/imports/prospect-import-schema";
import { createProspectImportPreview } from "@/lib/imports/prospect-import-server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Large XLSX/CSV parse + Firestore staging can take minutes; keep off default short budgets. */
export const maxDuration = 300;
const MAX_MULTIPART_BYTES = PROSPECT_IMPORT_MAX_BYTES + 1024 * 1024;

export async function POST(req: Request) {
  const unsafeRuntimeError = getUnsafeLocalImportError();
  if (unsafeRuntimeError) {
    return NextResponse.json({ error: unsafeRuntimeError }, { status: 503 });
  }
  const guard = await guardAdminFeature("import");
  if (!guard.ok) return guard.response;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Document store is not configured (DATABASE_URL missing)." }, { status: 503 });
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ error: "Upload exceeds the 20 MB file limit." }, { status: 413 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload an XLSX or CSV file." }, { status: 400 });
    }
    const parsed = await parseProspectImportFile(file.name, Buffer.from(await file.arrayBuffer()));
    const job = await createProspectImportPreview({
      db,
      organizationId: guard.ctx.session.organizationId,
      uploaderId: guard.ctx.session.uid,
      uploaderEmail: guard.ctx.session.email,
      parsed,
    });
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not preview this import.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
