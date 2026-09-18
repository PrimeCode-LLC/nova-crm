/**
 * Conservative SQL pushdown planner for `queryDocuments`.
 *
 * Defaults to the Node filter/sort/limit path whenever a clause cannot be
 * proven equivalent to Prisma JSON / column predicates. The Node path stays
 * the source of truth for residual clauses.
 */

import type { Prisma } from "@/generated/prisma/client";
import { Prisma as PrismaNamespace } from "@/generated/prisma/client";
import type { QueryFilter, QuerySpec } from "@/lib/db/document-shim/store";
import { coerceInstantMs } from "@/lib/db/document-shim/timestamp";

/** Top-level payload fields that are stored as plain JSON scalars (ids / enums). */
const PUSHDOWN_EQ_SCALAR_FIELDS = new Set([
  "actorId",
  "authorId",
  "leadOwnerId",
  "createdById",
  "ownerId",
  "assigneeId",
  "userId",
  "leadId",
  "planId",
  "contactId",
  "accountId",
  "status",
  "deliveryStatus",
  "enabled",
  "hostId",
  "slug",
  "provider",
  "accountEmail",
  "ownerUid",
  "sentMessageId",
  "contactEmail",
  "email",
  "personalEmail",
  "libraryId",
  "type",
  "mailboxId",
  "featureKey",
  "dayKey",
  "channel",
  "kind",
  "source",
]);

/** Payload array fields queried with `array-contains` (manager hierarchy stamps). */
const PUSHDOWN_ARRAY_CONTAINS_FIELDS = new Set([
  "leadOwnerManagerIds",
  "ownerManagerIds",
  "userManagerIds",
  "assignedUserIds",
  "memberIds",
  "sharedOwnerIds",
  "prospectAssigneeIds",
]);

/** Order-by fields that map to real `pg_documents` columns (not JSONB). */
const PUSHDOWN_COLUMN_ORDER_FIELDS = new Set(["createdAt", "updatedAt"]);

/**
 * Instant fields stored as ISO strings in payload (via serializePayloadValue).
 * Range compares use JSON text ordering, which matches UTC ISO chronology.
 */
const PUSHDOWN_RANGE_ISO_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "occurredAt",
  "dueAt",
  "sentAt",
  "scheduledAt",
  "emailScheduledAt",
  "pausedAt",
  "completedAt",
  "lastActivityAt",
  "lastReplyAt",
  "lastEmailOpenedAt",
  "notBeforeAt",
  "expiresAt",
  "joinedAt",
  "acceptedAt",
]);

const SAFE_FIELD_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type QueryPushdownPlan = {
  /** Filters that will be applied in SQL. */
  pushedFilters: QueryFilter[];
  /** Filters that must still run in Node after deserialize. */
  residualFilters: QueryFilter[];
  /** Whether `orderBy` was pushed to a table column. */
  pushOrderBy: boolean;
  /** Whether `take` can be pushed (no startAfter, no residuals that shrink the set). */
  pushLimit: boolean;
  /** Human-readable reasons for residual / non-pushed clauses (debug / verify). */
  reasons: string[];
};

function isSafeFieldName(field: string): boolean {
  return SAFE_FIELD_NAME.test(field);
}

function isJsonScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Node `matchesFilter` does loose `String(v) === String(filter.value)`, so a
 * numeric payload `123` matches filter `"123"`. SQL jsonb equality does not.
 * Only push string/boolean (and null) equality — numbers stay residual in Node.
 */
function isPushdownEqualityValue(value: unknown): value is string | boolean | null {
  return value === null || typeof value === "string" || typeof value === "boolean";
}

/** Normalize filter values that Node would compare via `coerceInstantMs` into ISO strings. */
export function normalizePushdownInstant(value: unknown): string | null {
  const ms = coerceInstantMs(value);
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

export function canPushDownFilter(filter: QueryFilter): boolean {
  if (!isSafeFieldName(filter.field)) return false;
  if (filter.field === "organizationId") {
    // Applied via the dual org-column / payload OR — never as a lone JSON equals.
    return false;
  }

  switch (filter.op) {
    case "==":
      return PUSHDOWN_EQ_SCALAR_FIELDS.has(filter.field) && isPushdownEqualityValue(filter.value);
    case "!=":
      // SQL `NOT (payload->'f' = v)` is NULL (so excluded) when the key is absent,
      // while the Node comparator keeps those rows. Never equivalent — stay in Node.
      return false;
    case "in":
      return (
        PUSHDOWN_EQ_SCALAR_FIELDS.has(filter.field) &&
        Array.isArray(filter.value) &&
        filter.value.length > 0 &&
        filter.value.length <= 64 &&
        filter.value.every(isPushdownEqualityValue)
      );
    case "array-contains":
      return (
        PUSHDOWN_ARRAY_CONTAINS_FIELDS.has(filter.field) && isJsonScalar(filter.value)
      );
    case "<":
    case "<=":
    case ">":
    case ">=":
      // ISO text ordering matches coerceInstantMs for allowlisted *At fields.
      return (
        PUSHDOWN_RANGE_ISO_FIELDS.has(filter.field) &&
        normalizePushdownInstant(filter.value) != null
      );
    default:
      return false;
  }
}

export function canPushDownOrderBy(
  orderBy: { field: string; direction: "asc" | "desc" } | undefined,
): boolean {
  if (!orderBy) return true;
  return (
    isSafeFieldName(orderBy.field) && PUSHDOWN_COLUMN_ORDER_FIELDS.has(orderBy.field)
  );
}

/**
 * Build a Prisma `where` clause fragment for one pushable payload filter.
 * Returns null when the filter is not pushable (caller should treat as residual).
 */
export function buildPayloadFilterWhere(
  filter: QueryFilter,
): Prisma.PgDocumentWhereInput | null {
  if (!canPushDownFilter(filter)) return null;
  const path = [filter.field];

  switch (filter.op) {
    case "==":
      return { payload: { path, equals: filter.value as Prisma.InputJsonValue } };
    case "in": {
      const values = filter.value as unknown[];
      return {
        OR: values.map((value) => ({
          payload: { path, equals: value as Prisma.InputJsonValue },
        })),
      };
    }
    case "array-contains":
      return {
        payload: {
          path,
          array_contains: filter.value as Prisma.InputJsonValue,
        },
      };
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const iso = normalizePushdownInstant(filter.value);
      if (!iso) return null;
      // jsonb sorts JSON null below strings; Node's coerceInstantMs excludes nulls.
      // Exclude explicit JSON null so SQL cannot under-match the Node residual path.
      const rangeClause =
        filter.op === "<"
          ? { payload: { path, lt: iso } }
          : filter.op === "<="
            ? { payload: { path, lte: iso } }
            : filter.op === ">"
              ? { payload: { path, gt: iso } }
              : { payload: { path, gte: iso } };
      return {
        AND: [
          { NOT: { payload: { path, equals: PrismaNamespace.JsonNull } } },
          rangeClause,
        ],
      };
    }
    default:
      return null;
  }
}

export function planQueryPushdown(spec: QuerySpec): QueryPushdownPlan {
  const reasons: string[] = [];
  const pushedFilters: QueryFilter[] = [];
  const residualFilters: QueryFilter[] = [];

  if (spec.collectionGroup) {
    reasons.push("collectionGroup: keep Node path (cross-path scan)");
    return {
      pushedFilters: [],
      residualFilters: spec.filters.filter((f) => f.field !== "organizationId"),
      pushOrderBy: false,
      pushLimit: false,
      reasons,
    };
  }

  if (spec.startAfter?.length) {
    reasons.push("startAfter: not a keyset — do not push take; Node slices by id");
  }

  for (const filter of spec.filters) {
    if (filter.field === "organizationId") {
      // Dual org matching is always applied in SQL + Node defense-in-depth.
      continue;
    }
    if (canPushDownFilter(filter) && buildPayloadFilterWhere(filter)) {
      pushedFilters.push(filter);
    } else {
      residualFilters.push(filter);
      reasons.push(`residual filter ${filter.field} ${filter.op}`);
    }
  }

  const pushOrderBy = canPushDownOrderBy(spec.orderBy);
  if (spec.orderBy && !pushOrderBy) {
    reasons.push(`orderBy ${spec.orderBy.field}: not a table column — Node sort`);
  }

  // pathPrefix immediate-child check stays in Node (narrower than startsWith).
  // That residual shrink means SQL `take` would under-fetch — never push limit.
  const hasPathPrefix = Boolean(spec.pathPrefix);
  if (hasPathPrefix) {
    reasons.push("pathPrefix: SQL startsWith + Node isImmediateCollectionDocument");
  }

  const hasStartAfter = Boolean(spec.startAfter?.length);
  const pushLimit =
    spec.limit != null &&
    !hasStartAfter &&
    !hasPathPrefix &&
    residualFilters.length === 0 &&
    (pushOrderBy || !spec.orderBy);

  if (spec.limit != null && !pushLimit) {
    reasons.push(
      "limit: kept in Node (pathPrefix, residuals, startAfter, or unpushed orderBy)",
    );
  }

  return {
    pushedFilters,
    residualFilters,
    pushOrderBy,
    pushLimit,
    reasons,
  };
}

export function buildPgDocumentOrderBy(
  orderBy: { field: string; direction: "asc" | "desc" } | undefined,
  pushOrderBy: boolean,
): Prisma.PgDocumentOrderByWithRelationInput[] | undefined {
  if (!orderBy || !pushOrderBy) return undefined;
  if (orderBy.field === "createdAt") {
    return [{ createdAt: orderBy.direction }];
  }
  if (orderBy.field === "updatedAt") {
    return [{ updatedAt: orderBy.direction }];
  }
  return undefined;
}

/** Stable cache / verify key for a query spec (order-insensitive for filters). */
export function querySpecCacheKey(spec: QuerySpec): string {
  const filters = [...spec.filters]
    .map((f) => ({
      field: f.field,
      op: f.op,
      value: f.value,
    }))
    .sort((a, b) => {
      const fa = `${a.field}:${a.op}`;
      const fb = `${b.field}:${b.op}`;
      return fa.localeCompare(fb);
    });
  return JSON.stringify({
    collectionRoot: spec.collectionRoot ?? null,
    collectionGroup: spec.collectionGroup ?? null,
    pathPrefix: spec.pathPrefix ?? null,
    organizationId: spec.organizationId ?? null,
    filters,
    orderBy: spec.orderBy ?? null,
    limit: spec.limit ?? null,
    startAfter: spec.startAfter ?? null,
  });
}
