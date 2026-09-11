import { NextResponse } from "next/server";
import {
  deleteDocument,
  setDocument,
  updateDocument,
} from "@/lib/db/document-shim/store";
import { FIELD_DELETE, SERVER_TIMESTAMP } from "@/lib/db/document-shim/field-values";
import { serializePayloadValue } from "@/lib/db/document-shim/timestamp";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

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
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  try {
    const url = new URL(req.url);
    const collection = url.searchParams.get("collection");
    if (!collection) {
      return NextResponse.json({ error: "collection required" }, { status: 400 });
    }

    const orderByField = url.searchParams.get("orderBy")?.trim() || undefined;
    const orderDirRaw = url.searchParams.get("orderDir")?.trim().toLowerCase();
    const orderDir =
      orderDirRaw === "asc" || orderDirRaw === "desc" ? orderDirRaw : "desc";
    const limitRaw = url.searchParams.get("limit");
    const limitParsed = limitRaw != null ? Number(limitRaw) : undefined;
    const limit =
      typeof limitParsed === "number" &&
      Number.isFinite(limitParsed) &&
      limitParsed > 0
        ? Math.min(Math.floor(limitParsed), 2000)
        : undefined;

    const { queryDocuments } = await import("@/lib/db/document-shim/store");
    const collectionRoot = collection.split("/")[0] ?? collection;
    const docs = await queryDocuments({
      collectionRoot,
      pathPrefix: collection,
      filters: [{ field: "organizationId", op: "==", value: guard.ctx.session.organizationId }],
      ...(orderByField
        ? { orderBy: { field: orderByField, direction: orderDir } }
        : {}),
      ...(limit != null ? { limit } : {}),
    });

    return NextResponse.json({
      docs: docs.map((d) => ({
        id: d.path.split("/").pop() ?? d.path,
        // Timestamp class instances are not JSON-safe; normalize like writes do.
        data: serializePayloadValue(d.payload) as Record<string, unknown>,
      })),
    });
  } catch (err) {
    console.error("[workspace-documents GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load documents" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  try {
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
      organizationId: guard.ctx.session.organizationId,
    };
    await setDocument(body.path, data, body.merge ?? false);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[workspace-documents PUT]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save document" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  try {
    const body = (await req.json()) as {
      path?: string;
      patch?: Record<string, unknown>;
    };
    if (!body.path || !body.patch) {
      return NextResponse.json({ error: "path and patch required" }, { status: 400 });
    }
    await updateDocument(body.path, {
      ...decodeClientFieldValues(body.patch),
      organizationId: guard.ctx.session.organizationId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[workspace-documents PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update document" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  try {
    const body = (await req.json()) as { path?: string };
    if (!body.path) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }
    // Tenancy: only delete docs that belong to this org (path or payload).
    const { getDocument } = await import("@/lib/db/document-shim/store");
    const existing = await getDocument(body.path);
    if (existing) {
      const orgId = existing.organizationId ?? existing.payload.organizationId;
      if (orgId && orgId !== guard.ctx.session.organizationId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    await deleteDocument(body.path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[workspace-documents DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete document" },
      { status: 500 },
    );
  }
}
