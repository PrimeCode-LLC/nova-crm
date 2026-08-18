import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase/admin";
import { getUnsafeLocalImportError } from "@/lib/imports/prospect-import-runtime";
import { confirmProspectImportJob } from "@/lib/imports/prospect-import-server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";

/** Confirm is light (queue chunks); keep explicit budget for consistency. */
export const maxDuration = 60;

const bodySchema = z.object({
  policy: z.enum(["add_new", "update_non_empty", "replace"]),
  reimportConfirmed: z.boolean().default(false),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const unsafeRuntimeError = getUnsafeLocalImportError();
  if (unsafeRuntimeError) {
    return NextResponse.json({ error: unsafeRuntimeError }, { status: 503 });
  }
  const guard = await guardAdminFeature("import");
  if (!guard.ok) return guard.response;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Firebase Admin is not configured." }, { status: 503 });

  try {
    const body = bodySchema.parse(await req.json());
    const { jobId } = await params;
    const job = await confirmProspectImportJob({
      db,
      organizationId: guard.ctx.session.organizationId,
      uploaderId: guard.ctx.session.uid,
      jobId,
      policy: body.policy,
      reimportConfirmed: body.reimportConfirmed,
    });
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start this import.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
