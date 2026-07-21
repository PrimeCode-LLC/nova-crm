import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProspectImportJob } from "@/lib/imports/prospect-import-types";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardAdminFeature("import");
  if (!guard.ok) return guard.response;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Firebase Admin is not configured." }, { status: 503 });

  let docs;
  try {
    const snapshot = await db.collection(COLLECTIONS.importJobs)
      .where("organizationId", "==", guard.ctx.session.organizationId)
      .where("uploaderId", "==", guard.ctx.session.uid)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    docs = snapshot.docs;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? Number((error as { code?: unknown }).code)
        : 0;
    if (code !== 9) throw error;

    // Local development and fresh deployments may briefly lack the composite
    // index. Keep the page usable while the declared index is building.
    const fallback = await db.collection(COLLECTIONS.importJobs)
      .where("organizationId", "==", guard.ctx.session.organizationId)
      .limit(200)
      .get();
    docs = fallback.docs
      .filter((doc) => doc.data().uploaderId === guard.ctx.session.uid)
      .sort((a, b) =>
        String(b.data().createdAt ?? "").localeCompare(String(a.data().createdAt ?? "")),
      )
      .slice(0, 200);
  }

  const jobs = docs.map((doc) => ({
    ...(doc.data() as ProspectImportJob),
    id: doc.id,
    issueSamples: (doc.data().issueSamples as ProspectImportJob["issueSamples"] | undefined) ?? [],
  }));
  return NextResponse.json({ jobs });
}
