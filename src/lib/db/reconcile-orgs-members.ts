/**
 * Firestore ↔ Postgres reconciliation for organizations + members (P2.5).
 *
 * Compares counts and spot-checks scalar fields. Staging first (docs/ENVIRONMENTS.md).
 */

import type { QueryDocumentSnapshot } from "@/lib/db/document-shim/shim-firestore";

import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { listMembersServer } from "@/lib/platform/members-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import type { Organization, OrganizationMember } from "@/lib/types";

export type ReconcileFieldDiff = {
  entity: "organization" | "member";
  id: string;
  field: string;
  firestore: unknown;
  postgres: unknown;
};

export type OrgsMembersReconcileReport = {
  firestoreOrganizationCount: number;
  postgresOrganizationCount: number;
  firestoreMemberCount: number;
  postgresMemberCount: number;
  missingInPostgres: { organizations: string[]; members: string[] };
  missingInFirestore: { organizations: string[]; members: string[] };
  fieldDiffs: ReconcileFieldDiff[];
  organizationsCompared: number;
  membersCompared: number;
  errors: string[];
  /** True when counts match and no missing rows / field diffs / errors. */
  clean: boolean;
};

export type OrgsMembersReconcileOptions = {
  organizationId?: string;
  /** Max orgs to deep-compare (counts still cover all when possible). */
  sampleLimit?: number;
  pageSize?: number;
  onProgress?: (message: string) => void;
};

export type PostgresOrganizationRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planId: string;
  maxUsers: number | null;
  seatsUsed: number;
  ownerUid: string | null;
  primaryEmail: string | null;
  pendingOwnerEmail: string | null;
  intakePoolEpoch: number;
};

export type PostgresMemberRow = {
  uid: string;
  organizationId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  invitedByUid: string;
};

export type OrgsMembersReconcileDeps = {
  isDbReady: () => boolean;
  isDocumentStoreReady: () => boolean;
  listOrganizationIds: (opts: {
    organizationId?: string;
    pageSize: number;
    limit?: number;
  }) => AsyncGenerator<string, void, undefined>;
  getOrganization: (orgId: string) => Promise<Organization | null>;
  listMembers: (orgId: string) => Promise<OrganizationMember[]>;
  countPostgresOrganizations: () => Promise<number>;
  countPostgresMembers: () => Promise<number>;
  getPostgresOrganization: (
    orgId: string,
  ) => Promise<PostgresOrganizationRow | null>;
  listPostgresMembers: (orgId: string) => Promise<PostgresMemberRow[]>;
  listAllPostgresOrganizationIds: () => Promise<string[]>;
  listAllPostgresMemberKeys: () => Promise<string[]>;
};

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_SAMPLE_LIMIT = 50;

async function* listOrganizationIdsFromFirestore(opts: {
  organizationId?: string;
  pageSize: number;
  limit?: number;
}): AsyncGenerator<string, void, undefined> {
  const db = getAdminDb();
  if (!db) return;

  if (opts.organizationId) {
    const snap = await db
      .collection(COLLECTIONS.organizations)
      .doc(opts.organizationId)
      .get();
    if (snap.exists) yield snap.id;
    return;
  }

  let yielded = 0;
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collection(COLLECTIONS.organizations)
      .orderBy("__name__")
      .limit(opts.pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      yield doc.id;
      yielded += 1;
      if (opts.limit != null && yielded >= opts.limit) return;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < opts.pageSize) break;
  }
}

function memberKey(organizationId: string, uid: string): string {
  return `${organizationId}/${uid}`;
}

function normStr(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length ? t : null;
}

function pushDiff(
  diffs: ReconcileFieldDiff[],
  entity: ReconcileFieldDiff["entity"],
  id: string,
  field: string,
  firestore: unknown,
  postgres: unknown,
): void {
  if (firestore === postgres) return;
  // Treat null and undefined as equivalent for optional scalars.
  if (firestore == null && postgres == null) return;
  diffs.push({ entity, id, field, firestore, postgres });
}

/** Exported for unit tests — compare mapped Firestore org vs Postgres row. */
export function diffOrganizationFields(
  fs: Organization,
  pg: PostgresOrganizationRow,
): ReconcileFieldDiff[] {
  const diffs: ReconcileFieldDiff[] = [];
  const id = fs.id;
  pushDiff(diffs, "organization", id, "name", fs.name, pg.name);
  pushDiff(diffs, "organization", id, "slug", fs.slug, pg.slug);
  pushDiff(diffs, "organization", id, "status", fs.status, pg.status);
  pushDiff(diffs, "organization", id, "planId", fs.planId, pg.planId);
  pushDiff(
    diffs,
    "organization",
    id,
    "maxUsers",
    fs.maxUsers ?? null,
    pg.maxUsers,
  );
  pushDiff(
    diffs,
    "organization",
    id,
    "seatsUsed",
    fs.seatsUsed ?? 0,
    pg.seatsUsed,
  );
  pushDiff(
    diffs,
    "organization",
    id,
    "ownerUid",
    normStr(fs.ownerUid),
    normStr(pg.ownerUid),
  );
  pushDiff(
    diffs,
    "organization",
    id,
    "primaryEmail",
    normStr(fs.primaryEmail)?.toLowerCase() ?? null,
    normStr(pg.primaryEmail)?.toLowerCase() ?? null,
  );
  pushDiff(
    diffs,
    "organization",
    id,
    "pendingOwnerEmail",
    normStr(fs.pendingOwnerEmail)?.toLowerCase() ?? null,
    normStr(pg.pendingOwnerEmail)?.toLowerCase() ?? null,
  );
  pushDiff(
    diffs,
    "organization",
    id,
    "intakePoolEpoch",
    fs.intakePoolEpoch ?? 1,
    pg.intakePoolEpoch,
  );
  return diffs;
}

/** Exported for unit tests — compare mapped Firestore member vs Postgres row. */
export function diffMemberFields(
  fs: OrganizationMember,
  pg: PostgresMemberRow,
): ReconcileFieldDiff[] {
  const diffs: ReconcileFieldDiff[] = [];
  const id = memberKey(fs.organizationId, fs.uid);
  pushDiff(diffs, "member", id, "email", fs.email.toLowerCase(), pg.email.toLowerCase());
  pushDiff(diffs, "member", id, "displayName", fs.displayName, pg.displayName);
  pushDiff(diffs, "member", id, "role", fs.role, pg.role);
  pushDiff(diffs, "member", id, "status", fs.status, pg.status);
  pushDiff(diffs, "member", id, "invitedByUid", fs.invitedByUid, pg.invitedByUid);
  pushDiff(
    diffs,
    "member",
    id,
    "organizationId",
    fs.organizationId,
    pg.organizationId,
  );
  return diffs;
}

export function createDefaultOrgsMembersReconcileDeps(): OrgsMembersReconcileDeps {
  return {
    isDbReady: () => isDatabaseConfigured(),
    isDocumentStoreReady: () => Boolean(getAdminDb()),
    listOrganizationIds: listOrganizationIdsFromFirestore,
    getOrganization: getOrganizationServer,
    listMembers: listMembersServer,
    countPostgresOrganizations: async () =>
      withRlsBypass((tx) => tx.organization.count()),
    countPostgresMembers: async () => withRlsBypass((tx) => tx.member.count()),
    getPostgresOrganization: async (orgId) =>
      withRlsBypass((tx) =>
        tx.organization.findUnique({
          where: { id: orgId },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            planId: true,
            maxUsers: true,
            seatsUsed: true,
            ownerUid: true,
            primaryEmail: true,
            pendingOwnerEmail: true,
            intakePoolEpoch: true,
          },
        }),
      ),
    listPostgresMembers: async (orgId) =>
      withRlsBypass((tx) =>
        tx.member.findMany({
          where: { organizationId: orgId },
          select: {
            uid: true,
            organizationId: true,
            email: true,
            displayName: true,
            role: true,
            status: true,
            invitedByUid: true,
          },
        }),
      ),
    listAllPostgresOrganizationIds: async () => {
      const rows = await withRlsBypass((tx) =>
        tx.organization.findMany({ select: { id: true } }),
      );
      return rows.map((r) => r.id);
    },
    listAllPostgresMemberKeys: async () => {
      const rows = await withRlsBypass((tx) =>
        tx.member.findMany({ select: { organizationId: true, uid: true } }),
      );
      return rows.map((r) => memberKey(r.organizationId, r.uid));
    },
  };
}

export async function runOrgsMembersReconcile(
  options: OrgsMembersReconcileOptions = {},
  deps: OrgsMembersReconcileDeps = createDefaultOrgsMembersReconcileDeps(),
): Promise<OrgsMembersReconcileReport> {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const sampleLimit = Math.max(
    1,
    options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT,
  );
  const log = options.onProgress ?? (() => undefined);

  const report: OrgsMembersReconcileReport = {
    firestoreOrganizationCount: 0,
    postgresOrganizationCount: 0,
    firestoreMemberCount: 0,
    postgresMemberCount: 0,
    missingInPostgres: { organizations: [], members: [] },
    missingInFirestore: { organizations: [], members: [] },
    fieldDiffs: [],
    organizationsCompared: 0,
    membersCompared: 0,
    errors: [],
    clean: false,
  };

  if (!deps.isDbReady()) {
    report.errors.push(
      "DATABASE_URL is not set (need nova_app runtime URL — see docs/ENVIRONMENTS.md).",
    );
    return report;
  }
  if (!deps.isDocumentStoreReady()) {
    report.errors.push(
      "Document store is not configured (FIREBASE_ADMIN_* env vars).",
    );
    return report;
  }

  const scopedOrgId = options.organizationId?.trim() || undefined;

  try {
    if (scopedOrgId) {
      const pgOrg = await deps.getPostgresOrganization(scopedOrgId);
      const pgMembers = await deps.listPostgresMembers(scopedOrgId);
      report.postgresOrganizationCount = pgOrg ? 1 : 0;
      report.postgresMemberCount = pgMembers.length;
    } else {
      report.postgresOrganizationCount = await deps.countPostgresOrganizations();
      report.postgresMemberCount = await deps.countPostgresMembers();
    }
  } catch (err) {
    report.errors.push(
      `postgres count failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return report;
  }

  const firestoreOrgIds: string[] = [];
  const firestoreMemberKeys = new Set<string>();

  for await (const orgId of deps.listOrganizationIds({
    organizationId: scopedOrgId,
    pageSize,
    limit: scopedOrgId ? 1 : undefined,
  })) {
    firestoreOrgIds.push(orgId);
  }
  report.firestoreOrganizationCount = firestoreOrgIds.length;

  const orgsToCompare = firestoreOrgIds.slice(0, sampleLimit);

  for (const orgId of orgsToCompare) {
    try {
      const fsOrg = await deps.getOrganization(orgId);
      if (!fsOrg) {
        report.errors.push(`firestore org missing after list: ${orgId}`);
        continue;
      }

      const pgOrg = await deps.getPostgresOrganization(orgId);
      if (!pgOrg) {
        report.missingInPostgres.organizations.push(orgId);
      } else {
        report.organizationsCompared += 1;
        report.fieldDiffs.push(...diffOrganizationFields(fsOrg, pgOrg));
      }

      const fsMembers = await deps.listMembers(orgId);
      report.firestoreMemberCount += fsMembers.length;
      for (const m of fsMembers) {
        firestoreMemberKeys.add(memberKey(m.organizationId, m.uid));
      }

      const pgMembers = await deps.listPostgresMembers(orgId);
      const pgByUid = new Map(pgMembers.map((m) => [m.uid, m]));

      for (const m of fsMembers) {
        const key = memberKey(m.organizationId, m.uid);
        const pg = pgByUid.get(m.uid);
        if (!pg) {
          report.missingInPostgres.members.push(key);
          continue;
        }
        report.membersCompared += 1;
        report.fieldDiffs.push(...diffMemberFields(m, pg));
      }

      for (const pg of pgMembers) {
        if (!fsMembers.some((m) => m.uid === pg.uid)) {
          report.missingInFirestore.members.push(
            memberKey(pg.organizationId, pg.uid),
          );
        }
      }

      log(
        `compared org ${orgId}: fsMembers=${fsMembers.length} pgMembers=${pgMembers.length}`,
      );
    } catch (err) {
      report.errors.push(
        `org ${orgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Orgs beyond sample: still count Firestore members for totals when not org-filtered.
  if (!scopedOrgId && firestoreOrgIds.length > orgsToCompare.length) {
    for (const orgId of firestoreOrgIds.slice(sampleLimit)) {
      try {
        const members = await deps.listMembers(orgId);
        report.firestoreMemberCount += members.length;
        for (const m of members) {
          firestoreMemberKeys.add(memberKey(m.organizationId, m.uid));
        }
      } catch (err) {
        report.errors.push(
          `member count ${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Full set compare for missing rows (field diffs remain sample-scoped).
  try {
    if (scopedOrgId) {
      if (
        report.postgresOrganizationCount > 0 &&
        !firestoreOrgIds.includes(scopedOrgId)
      ) {
        report.missingInFirestore.organizations.push(scopedOrgId);
      }
    } else {
      const pgOrgIds = await deps.listAllPostgresOrganizationIds();
      const fsOrgSet = new Set(firestoreOrgIds);
      const pgOrgSet = new Set(pgOrgIds);
      for (const id of firestoreOrgIds) {
        if (
          !pgOrgSet.has(id) &&
          !report.missingInPostgres.organizations.includes(id)
        ) {
          report.missingInPostgres.organizations.push(id);
        }
      }
      for (const id of pgOrgIds) {
        if (!fsOrgSet.has(id)) report.missingInFirestore.organizations.push(id);
      }

      const pgMemberKeys = await deps.listAllPostgresMemberKeys();
      const pgMemberSet = new Set(pgMemberKeys);
      for (const key of firestoreMemberKeys) {
        if (
          !pgMemberSet.has(key) &&
          !report.missingInPostgres.members.includes(key)
        ) {
          report.missingInPostgres.members.push(key);
        }
      }
      for (const key of pgMemberKeys) {
        if (
          !firestoreMemberKeys.has(key) &&
          !report.missingInFirestore.members.includes(key)
        ) {
          report.missingInFirestore.members.push(key);
        }
      }
    }
  } catch (err) {
    report.errors.push(
      `postgres orphan scan failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  report.clean =
    report.errors.length === 0 &&
    report.fieldDiffs.length === 0 &&
    report.missingInPostgres.organizations.length === 0 &&
    report.missingInPostgres.members.length === 0 &&
    report.missingInFirestore.organizations.length === 0 &&
    report.missingInFirestore.members.length === 0 &&
    report.firestoreOrganizationCount === report.postgresOrganizationCount &&
    report.firestoreMemberCount === report.postgresMemberCount;

  return report;
}
