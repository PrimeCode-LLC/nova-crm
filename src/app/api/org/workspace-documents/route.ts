import { NextResponse } from "next/server";
import {
  deleteDocument,
  setDocument,
  updateDocument,
} from "@/lib/db/document-shim/store";
import { FIELD_DELETE, SERVER_TIMESTAMP } from "@/lib/db/document-shim/field-values";
import { requireTenantSession } from "@/lib/auth/server";

/**
 * Revive client FieldValue markers after JSON transport.
 * Symbols (deleteField / serverTimestamp) cannot survive JSON.stringify; the
 * client encodes them as `{ __fv: "delete" | "serverTimestamp" }`.
 */
function decodeClientFieldValues(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "__fv" in (value as object)) {
      const op = String((value as { __fv: unknown }).__fv);
      if (op === "delete") {
        out[key] = FIELD_DELETE;
        continue;
      }
      if (op === "serverTimestamp") {
        out[key] = SERVER_TIMESTAMP;
        continue;
      }
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if (
        "__increment" in (value as object) ||
        "__arrayUnion" in (value as object) ||
        "__arrayRemove" in (value as object)
      ) {
        out[key] = value;
        continue;
      }
      out[key] = decodeClientFieldValues(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function GET(req: Request) {
  const session = await requireTenantSession();
  const url = new URL(req.url);
  const collection = url.searchParams.get("collection");
  if (!collection) {
    return NextResponse.json({ error: "collection required" }, { status: 400 });
  }

  const { queryDocuments } = await import("@/lib/db/document-shim/store");
  const collectionRoot = collection.split("/")[0] ?? collection;
  const docs = await queryDocuments({
    collectionRoot,
    pathPrefix: collection,
    filters: [{ field: "organizationId", op: "==", value: session.organizationId }],
  });

  return NextResponse.json({
    docs: docs.map((d) => ({
      id: d.path.split("/").pop() ?? d.path,
      data: d.payload,
    })),
  });
}

export async function PUT(req: Request) {
  const session = await requireTenantSession();
  const body = (await req.json()) as {
    path?: string;
    data?: Record<string, unknown>;
    merge?: boolean;
  };
  if (!body.path || !body.data) {
    return NextResponse.json({ error: "path and data required" }, { status: 400 });
  }
  const data = {
    ...decodeClientFieldValues(body.data),
    organizationId: session.organizationId,
  };
  await setDocument(body.path, data, body.merge ?? false);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const session = await requireTenantSession();
  const body = (await req.json()) as {
    path?: string;
    patch?: Record<string, unknown>;
  };
  if (!body.path || !body.patch) {
    return NextResponse.json({ error: "path and patch required" }, { status: 400 });
  }
  await updateDocument(body.path, {
    ...decodeClientFieldValues(body.patch),
    organizationId: session.organizationId,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  await requireTenantSession();
  const body = (await req.json()) as { path?: string };
  if (!body.path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  await deleteDocument(body.path);
  return NextResponse.json({ ok: true });
}
