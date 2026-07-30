import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  listErrorLogsServer,
  recordErrorLog,
} from "@/lib/error-logging/record-error-server";
import type { ErrorLogSource } from "@/lib/error-logging/types";
import {
  ERROR_LOG_FUNCTION_MAX,
  ERROR_LOG_LOCATION_MAX,
  ERROR_LOG_MESSAGE_MAX,
  ERROR_LOG_STACK_MAX,
  ERROR_LOG_URL_MAX,
} from "@/lib/error-logging/types";

const postBodySchema = z.object({
  message: z.string().min(1).max(ERROR_LOG_MESSAGE_MAX),
  location: z.string().max(ERROR_LOG_LOCATION_MAX).nullable().optional(),
  functionName: z.string().max(ERROR_LOG_FUNCTION_MAX).nullable().optional(),
  stack: z.string().max(ERROR_LOG_STACK_MAX).nullable().optional(),
  url: z.string().max(ERROR_LOG_URL_MAX).nullable().optional(),
  route: z.string().max(300).nullable().optional(),
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
});

/** Simple in-memory rate limit per uid (best-effort; resets on cold start). */
const postBuckets = new Map<string, { count: number; resetAt: number }>();
const POST_LIMIT = 40;
const POST_WINDOW_MS = 60_000;

function allowPost(uid: string): boolean {
  const now = Date.now();
  const bucket = postBuckets.get(uid);
  if (!bucket || now >= bucket.resetAt) {
    postBuckets.set(uid, { count: 1, resetAt: now + POST_WINDOW_MS });
    return true;
  }
  if (bucket.count >= POST_LIMIT) return false;
  bucket.count += 1;
  return true;
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  if (!allowPost(g.ctx.session.uid)) {
    return NextResponse.json({ error: "Too many error reports." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid error report payload." }, { status: 400 });
  }

  const id = await recordErrorLog({
    organizationId: g.ctx.session.organizationId,
    message: parsed.data.message,
    source: "client",
    location: parsed.data.location,
    functionName: parsed.data.functionName,
    stack: parsed.data.stack,
    url: parsed.data.url,
    route: parsed.data.route,
    httpStatus: parsed.data.httpStatus ?? null,
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email ?? null,
  });

  return NextResponse.json({ ok: true, id });
}

export async function GET(req: Request) {
  const g = await guardAdminFeature("activity_logs");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const sourceParam = url.searchParams.get("source");
  const source: ErrorLogSource | undefined =
    sourceParam === "client" || sourceParam === "server" ? sourceParam : undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const fromDate = url.searchParams.get("from") ?? undefined;
  const toDate = url.searchParams.get("to") ?? undefined;

  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (fromDate && !ymd.test(fromDate)) {
    return NextResponse.json({ error: "Invalid from date. Use YYYY-MM-DD." }, { status: 400 });
  }
  if (toDate && !ymd.test(toDate)) {
    return NextResponse.json({ error: "Invalid to date. Use YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const { items, nextCursor, totalCount } = await listErrorLogsServer({
      organizationId: g.ctx.session.organizationId,
      limit: Number.isFinite(limit) ? limit : 50,
      cursor,
      source,
      search,
      fromDate: fromDate ?? null,
      toDate: toDate ?? null,
    });

    return NextResponse.json({ items, nextCursor, totalCount });
  } catch (e) {
    console.error("[error-logs] list failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load error logs." },
      { status: 500 },
    );
  }
}
