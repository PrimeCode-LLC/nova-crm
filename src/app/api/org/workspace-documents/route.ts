import { NextResponse } from "next/server";
import {
  deleteDocument,
  getDocument,
  queryDocuments,
  setDocument,
  updateDocument,
  type QueryFilter,
  type StoredDoc,
} from "@/lib/db/document-shim/store";
import { FIELD_DELETE, SERVER_TIMESTAMP } from "@/lib/db/document-shim/field-values";
import { parsePath } from "@/lib/db/document-shim/path";
import { projectWorkspaceListPayload } from "@/lib/db/document-shim/timestamp";
import {
  MEMBER_SCOPED_WORKSPACE_COLLECTIONS,
  memberCanAccessWorkspaceDoc,
  memberWorkspaceDocSlices,
  workspaceDocSeesAll,
} from "@/lib/db/workspace-document-member-scope";
import { COLLECTIONS } from "@/lib/documents/collections";
import { guardTenantApi, type TenantApiContext } from "@/lib/platform/tenant-api-guard";

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

function isSafeDocPath(path: string): boolean {
  if (!path || path.length > 512) return false;
  if (path.includes("\\") || path.includes("..") || path.startsWith("/")) return false;
  const segments = path.split("/").filter(Boolean);
  return segments.length >= 2 && segments.every((s) => s.length > 0 && !s.includes(".."));
}

function isSafeCollectionPath(collection: string): boolean {
  if (!collection || collection.length > 512) return false;
  if (collection.includes("\\") || collection.includes("..") || collection.startsWith("/")) {
    return false;
  }
  const segments = collection.split("/").filter(Boolean);
  return segments.length >= 1 && segments.every((s) => s.length > 0);
}

/**
 * Nested org paths encode tenant in segment[1]. Reject writes/reads that target
 * another org even when the JSON body carries the caller's organizationId.
 */
function forbidIfPathOutsideTenant(
  pathOrCollection: string,
  organizationId: string,
): NextResponse | null {
  const parsed = parsePath(pathOrCollection);
  if (parsed.collectionRoot === "organizations") {
    const pathOrg = parsed.segments[1];
    if (!pathOrg || pathOrg !== organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  return null;
}

/** Resolve tenant ownership from column first, then payload (legacy rows). */
function resolveDocOrganizationId(doc: StoredDoc): string | null {
  if (typeof doc.organizationId === "string" && doc.organizationId.trim()) {
    return doc.organizationId.trim();
  }
  const payloadOrg = doc.payload.organizationId;
  if (typeof payloadOrg === "string" && payloadOrg.trim()) {
    return payloadOrg.trim();
  }
  return null;
}

function forbidIfForeignDoc(
  doc: StoredDoc | null,
  organizationId: string,
): NextResponse | null {
  if (!doc) return null;
  const ownerOrg = resolveDocOrganizationId(doc);
  // Orphan / foreign docs must not be readable or writable by a tenant session.
  if (!ownerOrg || ownerOrg !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

function collectionRootOf(pathOrCollection: string): string {
  return pathOrCollection.split("/")[0] ?? pathOrCollection;
}

async function viewerSeesAllWorkspaceDocs(ctx: TenantApiContext): Promise<boolean> {
  if (workspaceDocSeesAll({ orgRole: ctx.role })) return true;
  const userDoc = await getDocument(`${COLLECTIONS.users}/${ctx.session.uid}`);
  const payload = userDoc?.payload ?? {};
  return workspaceDocSeesAll({
    orgRole: ctx.role,
    roleId: typeof payload.roleId === "string" ? payload.roleId : null,
    isSuperAdmin: payload.isSuperAdmin === true,
  });
}

async function queryMemberScopedDocs(input: {
  collectionRoot: string;
  pathPrefix: string;
  organizationId: string;
  uid: string;
  baseFilters: QueryFilter[];
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
}): Promise<StoredDoc[]> {
  const slices = memberWorkspaceDocSlices(input.collectionRoot, input.uid);
  const batches = await Promise.all(
    slices.map((slice) =>
      queryDocuments({
        collectionRoot: input.collectionRoot,
        pathPrefix: input.pathPrefix,
        organizationId: input.organizationId,
        filters: [
          ...input.baseFilters,
          slice.kind === "eq"
            ? { field: slice.field, op: "==" as const, value: slice.value }
            : { field: slice.field, op: "array-contains" as const, value: slice.value },
        ],
        ...(input.orderBy ? { orderBy: input.orderBy } : {}),
        ...(input.limit != null ? { limit: input.limit } : {}),
      }),
    ),
  );
  const byPath = new Map<string, StoredDoc>();
  for (const batch of batches) {
    for (const doc of batch) byPath.set(doc.path, doc);
  }
  return Array.from(byPath.values());
}

/** 403 when a non-oversight member reads or writes a peer row in a scoped collection. */
async function forbidIfMemberCannotAccessDoc(
  ctx: TenantApiContext,
  collectionRoot: string,
  payload: Record<string, unknown> | null,
): Promise<NextResponse | null> {
  if (!MEMBER_SCOPED_WORKSPACE_COLLECTIONS.has(collectionRoot)) return null;
  if (await viewerSeesAllWorkspaceDocs(ctx)) return null;
  if (!payload || !memberCanAccessWorkspaceDoc(collectionRoot, payload, ctx.session.uid)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  try {
    const url = new URL(req.url);
    const organizationId = guard.ctx.session.organizationId;
    const path = url.searchParams.get("path");
    const collection = url.searchParams.get("collection");

    // Single-doc read (full payload) — used to hydrate omitted list fields like messageBody.
    if (path) {
      if (!isSafeDocPath(path)) {
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      }
      const pathDenied = forbidIfPathOutsideTenant(path, organizationId);
      if (pathDenied) return pathDenied;

      const { serializePayloadValue } = await import("@/lib/db/document-shim/timestamp");
      const existing = await getDocument(path);
      if (!existing) {
        return NextResponse.json({ docs: [] });
      }
      const denied = forbidIfForeignDoc(existing, organizationId);
      if (denied) return denied;
      const memberDenied = await forbidIfMemberCannotAccessDoc(
        guard.ctx,
        collectionRootOf(path),
        existing.payload,
      );
      if (memberDenied) return memberDenied;
      return NextResponse.json({
        docs: [
          {
            id: existing.path.split("/").pop() ?? existing.path,
            data: serializePayloadValue(existing.payload) as Record<string, unknown>,
          },
        ],
      });
    }

    if (!collection) {
      return NextResponse.json({ error: "collection or path required" }, { status: 400 });
    }
    if (!isSafeCollectionPath(collection)) {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
    }
    const collectionDenied = forbidIfPathOutsideTenant(collection, organizationId);
    if (collectionDenied) return collectionDenied;

    const orderByField = url.searchParams.get("orderBy")?.trim() || undefined;
    const orderDirRaw = url.searchParams.get("orderDir")?.trim().toLowerCase();
    const orderDir: "asc" | "desc" =
      orderDirRaw === "asc" || orderDirRaw === "desc" ? orderDirRaw : "desc";
    const limitRaw = url.searchParams.get("limit");
    const limitParsed = limitRaw != null ? Number(limitRaw) : undefined;
    const limit =
      typeof limitParsed === "number" &&
      Number.isFinite(limitParsed) &&
      limitParsed > 0
        ? Math.min(Math.floor(limitParsed), 2000)
        : undefined;

    /** Allowlisted equality filters for member-scoped history polls. */
    const EQ_FIELDS = new Set([
      "actorId",
      "authorId",
      "leadOwnerId",
      "createdById",
      "ownerId",
      "assigneeId",
      "userId",
    ]);
    /** Allowlisted array-contains fields (manager hierarchy stamps). */
    const ARRAY_CONTAINS_FIELDS = new Set([
      "leadOwnerManagerIds",
      "ownerManagerIds",
      "userManagerIds",
    ]);
    const eqField = url.searchParams.get("eqField")?.trim() || undefined;
    const eqValue = url.searchParams.get("eqValue")?.trim() || undefined;
    const arrayContainsField =
      url.searchParams.get("arrayContainsField")?.trim() || undefined;
    const arrayContainsValue =
      url.searchParams.get("arrayContainsValue")?.trim() || undefined;
    const equalityFilters =
      eqField &&
      eqValue &&
      EQ_FIELDS.has(eqField) &&
      eqValue.length > 0 &&
      eqValue.length <= 128
        ? [{ field: eqField, op: "==" as const, value: eqValue }]
        : [];
    const arrayContainsFilters =
      arrayContainsField &&
      arrayContainsValue &&
      ARRAY_CONTAINS_FIELDS.has(arrayContainsField) &&
      arrayContainsValue.length > 0 &&
      arrayContainsValue.length <= 128
        ? [
            {
              field: arrayContainsField,
              op: "array-contains" as const,
              value: arrayContainsValue,
            },
          ]
        : [];

    const collectionRoot = collection.split("/")[0] ?? collection;
    const seesAll = await viewerSeesAllWorkspaceDocs(guard.ctx);
    const memberScoped =
      !seesAll && MEMBER_SCOPED_WORKSPACE_COLLECTIONS.has(collectionRoot);
    const baseFilters: QueryFilter[] = [
      { field: "organizationId", op: "==", value: organizationId },
    ];
    const order =
      orderByField != null
        ? { orderBy: { field: orderByField, direction: orderDir } }
        : {};
    const limitOpt = limit != null ? { limit } : {};

    const docs = memberScoped
      ? await queryMemberScopedDocs({
          collectionRoot,
          pathPrefix: collection,
          organizationId,
          uid: guard.ctx.session.uid,
          baseFilters,
          ...order,
          ...limitOpt,
        })
      : await queryDocuments({
          collectionRoot,
          pathPrefix: collection,
          organizationId,
          filters: [...baseFilters, ...equalityFilters, ...arrayContainsFilters],
          ...order,
          ...limitOpt,
        });

    const projected = docs.flatMap((d) => {
      try {
        return [
          {
            id: d.path.split("/").pop() ?? d.path,
            data: projectWorkspaceListPayload(d.payload),
          },
        ];
      } catch (err) {
        console.error("[workspace-documents GET] skip bad doc", d.path, err);
        return [];
      }
    });

    return NextResponse.json({ docs: projected });
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
    if (!isSafeDocPath(body.path)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const organizationId = guard.ctx.session.organizationId;
    const pathDenied = forbidIfPathOutsideTenant(body.path, organizationId);
    if (pathDenied) return pathDenied;

    const existing = await getDocument(body.path);
    const denied = forbidIfForeignDoc(existing, organizationId);
    if (denied) return denied;
    const memberDenied = await forbidIfMemberCannotAccessDoc(
      guard.ctx,
      collectionRootOf(body.path),
      existing?.payload ?? body.data,
    );
    if (memberDenied) return memberDenied;

    const data = {
      ...decodeClientFieldValues(body.data),
      organizationId,
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
    if (!isSafeDocPath(body.path)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const organizationId = guard.ctx.session.organizationId;
    const pathDenied = forbidIfPathOutsideTenant(body.path, organizationId);
    if (pathDenied) return pathDenied;

    const existing = await getDocument(body.path);
    const denied = forbidIfForeignDoc(existing, organizationId);
    if (denied) return denied;
    const memberDenied = await forbidIfMemberCannotAccessDoc(
      guard.ctx,
      collectionRootOf(body.path),
      existing?.payload ?? null,
    );
    if (memberDenied) return memberDenied;

    await updateDocument(body.path, {
      ...decodeClientFieldValues(body.patch),
      organizationId,
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
    if (!isSafeDocPath(body.path)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const organizationId = guard.ctx.session.organizationId;
    const pathDenied = forbidIfPathOutsideTenant(body.path, organizationId);
    if (pathDenied) return pathDenied;

    const existing = await getDocument(body.path);
    // Missing doc: idempotent success (do not leak whether a foreign path existed).
    if (!existing) {
      return NextResponse.json({ ok: true });
    }
    const denied = forbidIfForeignDoc(existing, organizationId);
    if (denied) return denied;
    const memberDenied = await forbidIfMemberCannotAccessDoc(
      guard.ctx,
      collectionRootOf(body.path),
      existing.payload,
    );
    if (memberDenied) return memberDenied;

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
