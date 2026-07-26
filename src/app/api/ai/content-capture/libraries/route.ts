import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";

/**
 * Lightweight library list for Capture (content users — not admin-only).
 */
export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) return NextResponse.json({ libraries: [] });

  const orgId = g.ctx.session.organizationId;
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .get();

  const libraries = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name ?? d.id).trim() || d.id,
        description:
          typeof data.description === "string" ? data.description.trim() : undefined,
        libraryKind: typeof data.libraryKind === "string" ? data.libraryKind : undefined,
        documentCount: Number(data.documentCount ?? 0) || 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ libraries });
}
