import {
  FieldValue,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import {
  messageFromUnknown,
  parseErrorStack,
  stackFromUnknown,
} from "@/lib/error-logging/parse-stack";
import {
  sanitizeFunctionName,
  sanitizeLocation,
  sanitizeMessage,
  sanitizeStack,
  sanitizeUrl,
} from "@/lib/error-logging/sanitize";
import type { ErrorLogRecord, ErrorLogSource, ReportErrorInput } from "@/lib/error-logging/types";

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function docToErrorLogRecord(
  doc: QueryDocumentSnapshot,
  organizationId: string,
): ErrorLogRecord {
  const data = doc.data();
  const source: ErrorLogSource =
    data.source === "server" || data.source === "client" ? data.source : "server";
  return {
    id: doc.id,
    organizationId: String(data.organizationId ?? organizationId),
    createdAt: timestampToIso(data.createdAt),
    location: typeof data.location === "string" ? data.location : "unknown",
    functionName: typeof data.functionName === "string" ? data.functionName : "unknown",
    message: typeof data.message === "string" ? data.message : "Unknown error",
    stack: typeof data.stack === "string" ? data.stack : null,
    source,
    actorUid: typeof data.actorUid === "string" ? data.actorUid : null,
    actorEmail: typeof data.actorEmail === "string" ? data.actorEmail : null,
    url: typeof data.url === "string" ? data.url : null,
    route: typeof data.route === "string" ? data.route : null,
    httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : null,
  };
}

/**
 * Append-only per-tenant error log. Failures are swallowed so logging
 * never breaks the primary request or UI flow.
 */
export async function recordErrorLog(input: ReportErrorInput): Promise<string | null> {
  try {
    const db = getAdminDb();
    if (!db) return null;
    if (!input.organizationId) return null;

    const stack =
      sanitizeStack(input.stack ?? stackFromUnknown(input.error)) ?? null;
    const parsed = parseErrorStack(stack);
    const message = sanitizeMessage(
      input.message || messageFromUnknown(input.error),
    );
    const location = sanitizeLocation(input.location ?? parsed.location);
    const functionName = sanitizeFunctionName(
      input.functionName ?? parsed.functionName,
    );

    const payload = stripUndefined({
      organizationId: input.organizationId,
      createdAt: FieldValue.serverTimestamp(),
      location,
      functionName,
      message,
      stack,
      source: input.source,
      actorUid: input.actorUid ?? null,
      actorEmail: input.actorEmail ?? null,
      url: sanitizeUrl(input.url),
      route: truncateRoute(input.route),
      httpStatus:
        typeof input.httpStatus === "number" && Number.isFinite(input.httpStatus)
          ? Math.trunc(input.httpStatus)
          : null,
    }) as Record<string, unknown>;

    const ref = await db.collection(COLLECTIONS.errorLogs).add(payload);
    return ref.id;
  } catch (e) {
    console.error("[error-log]", e);
    return null;
  }
}

function truncateRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  const s = route.trim().slice(0, 300);
  return s || null;
}

function sortErrorLogs(items: ErrorLogRecord[]): ErrorLogRecord[] {
  return [...items].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id);
  });
}

function matchesErrorLogSearch(row: ErrorLogRecord, search: string): boolean {
  const hay = [
    row.message,
    row.location,
    row.functionName,
    row.route ?? "",
    row.url ?? "",
    row.actorEmail ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(search);
}

function isMissingIndexError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: number | string; message?: string; details?: string };
  const code = err.code;
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  return (
    code === 9 ||
    code === "failed-precondition" ||
    /requires an index/i.test(text) ||
    /FAILED_PRECONDITION/i.test(text)
  );
}

/**
 * Fallback when the composite index is not deployed yet:
 * equality filter only (no orderBy), then sort/paginate in memory.
 */
async function listErrorLogsInMemory(input: {
  organizationId: string;
  limit: number;
  cursor?: string;
  source?: ErrorLogSource;
  search?: string;
}): Promise<{ items: ErrorLogRecord[]; nextCursor: string | null; totalCount: number }> {
  const db = getAdminDb();
  if (!db) return { items: [], nextCursor: null, totalCount: 0 };

  const col = db.collection(COLLECTIONS.errorLogs);
  let q = col.where("organizationId", "==", input.organizationId);
  if (input.source) {
    q = q.where("source", "==", input.source);
  }
  const snap = await q.get();
  let items = sortErrorLogs(
    snap.docs.map((doc) => docToErrorLogRecord(doc, input.organizationId)),
  );

  const search = input.search?.trim().toLowerCase();
  if (search) {
    items = items.filter((row) => matchesErrorLogSearch(row, search));
  }

  const totalCount = items.length;
  let start = 0;
  if (input.cursor) {
    const idx = items.findIndex((row) => row.id === input.cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const slice = items.slice(start, start + input.limit + 1);
  const hasMore = slice.length > input.limit;
  const pageItems = hasMore ? slice.slice(0, input.limit) : slice;
  const nextCursor =
    hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1]!.id : null;

  return { items: pageItems, nextCursor, totalCount };
}

export async function listErrorLogsServer(input: {
  organizationId: string;
  limit?: number;
  cursor?: string;
  source?: ErrorLogSource;
  search?: string;
}): Promise<{ items: ErrorLogRecord[]; nextCursor: string | null; totalCount: number }> {
  const db = getAdminDb();
  if (!db) return { items: [], nextCursor: null, totalCount: 0 };

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const col = db.collection(COLLECTIONS.errorLogs);
  const base = col.where("organizationId", "==", input.organizationId);

  try {
    let totalCount = 0;
    try {
      const countQ = input.source
        ? base.where("source", "==", input.source)
        : base;
      const countSnap = await countQ.count().get();
      totalCount = countSnap.data().count;
    } catch {
      totalCount = 0;
    }

    const fetchLimit = limit + 1;
    let q = input.source
      ? base.where("source", "==", input.source).orderBy("createdAt", "desc").limit(fetchLimit)
      : base.orderBy("createdAt", "desc").limit(fetchLimit);

    if (input.cursor) {
      const cursorSnap = await col.doc(input.cursor).get();
      if (cursorSnap.exists) {
        q = input.source
          ? base
              .where("source", "==", input.source)
              .orderBy("createdAt", "desc")
              .startAfter(cursorSnap)
              .limit(fetchLimit)
          : base.orderBy("createdAt", "desc").startAfter(cursorSnap).limit(fetchLimit);
      }
    }

    const snap = await q.get();
    let items = snap.docs.map((doc) => docToErrorLogRecord(doc, input.organizationId));

    const search = input.search?.trim().toLowerCase();
    if (search) {
      items = items.filter((row) => matchesErrorLogSearch(row, search));
    }

    const hasMore = snap.docs.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor =
      hasMore && snap.docs.length > 0
        ? snap.docs[Math.min(limit, snap.docs.length) - 1]!.id
        : null;

    return { items: pageItems, nextCursor, totalCount };
  } catch (e) {
    if (isMissingIndexError(e)) {
      console.warn(
        "[error-log] Composite index missing for errorLogs; using in-memory list. Deploy firestore.indexes.json or open the Firebase console link from the original error.",
      );
      return listErrorLogsInMemory({
        organizationId: input.organizationId,
        limit,
        cursor: input.cursor,
        source: input.source,
        search: input.search,
      });
    }
    throw e;
  }
}
