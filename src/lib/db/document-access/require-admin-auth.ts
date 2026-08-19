import type { Auth } from "@/lib/db/document-shim/shim-auth";
import { NextResponse } from "next/server";

/** Return a 503 when admin auth shim is unavailable (DATABASE_URL missing). */
export function adminAuthRequiredResponse(
  adminAuth: Auth | null,
): NextResponse | null {
  if (adminAuth) return null;
  return NextResponse.json(
    {
      error:
        "Document store admin auth is unavailable. Configure DATABASE_URL or use Clerk-only flows.",
      code: "document_admin_unavailable",
    },
    { status: 503 },
  );
}
