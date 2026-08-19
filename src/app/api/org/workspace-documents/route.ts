import { NextResponse } from "next/server";
import {
  deleteDocument,
  setDocument,
  updateDocument,
} from "@/lib/db/pg-firestore/store";
import { requireTenantSession } from "@/lib/auth/server";

export async function GET(req: Request) {
  const session = await requireTenantSession();
  const url = new URL(req.url);
  const collection = url.searchParams.get("collection");
  if (!collection) {
    return NextResponse.json({ error: "collection required" }, { status: 400 });
  }

  const { queryDocuments } = await import("@/lib/db/pg-firestore/store");
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
  const data = { ...body.data, organizationId: session.organizationId };
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
    ...body.patch,
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
