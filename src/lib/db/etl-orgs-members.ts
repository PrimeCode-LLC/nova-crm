/**
 * Idempotent Firestore → Postgres ETL for organizations + members (P2.4).
 *
 * Safe to re-run: uses the same upsert mirrors as dual-write (P2.3).
 * Always run against staging first (docs/ENVIRONMENTS.md).
 */

import type { QueryDocumentSnapshot } from "@/lib/db/document-shim/shim-firestore";

import {
  upsertMemberMirror,
  upsertOrganizationMirror,
} from "@/lib/db/dual-write-orgs";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { listMembersServer } from "@/lib/platform/members-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import type { Organization, OrganizationMember } from "@/lib/types";

export type OrgsMembersEtlStats = {
  organizationsScanned: number;
  organizationsUpserted: number;
  membersScanned: number;
  membersUpserted: number;
  errors: string[];
  dryRun: boolean;
};

export type OrgsMembersEtlOptions = {
  /** When set, only this org (+ its members) is processed. */
  organizationId?: string;
  dryRun?: boolean;
  /** Max orgs to process (after filter). Useful for smoke runs. */
  limit?: number;
  pageSize?: number;
  onProgress?: (message: string) => void;
};

export type OrgsMembersEtlDeps = {
  isDbReady: () => boolean;
  isDocumentStoreReady: () => boolean;
  listOrganizationIds: (opts: {
    organizationId?: string;
    pageSize: number;
    limit?: number;
  }) => AsyncGenerator<string, void, undefined>;
  getOrganization: (orgId: string) => Promise<Organization | null>;
  listMembers: (orgId: string) => Promise<OrganizationMember[]>;
  upsertOrganization: (org: Organization) => Promise<void>;
  upsertMember: (member: OrganizationMember) => Promise<void>;
};

const DEFAULT_PAGE_SIZE = 100;

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

export function createDefaultOrgsMembersEtlDeps(): OrgsMembersEtlDeps {
  return {
    isDbReady: () => isDatabaseConfigured(),
    isDocumentStoreReady: () => Boolean(getAdminDb()),
    listOrganizationIds: listOrganizationIdsFromFirestore,
    getOrganization: getOrganizationServer,
    listMembers: listMembersServer,
    upsertOrganization: upsertOrganizationMirror,
    upsertMember: upsertMemberMirror,
  };
}

/**
 * Extract → transform → load organizations then members (FK order).
 * Idempotent via Prisma upsert on Firestore ids.
 */
export async function runOrgsMembersBackfill(
  options: OrgsMembersEtlOptions = {},
  deps: OrgsMembersEtlDeps = createDefaultOrgsMembersEtlDeps(),
): Promise<OrgsMembersEtlStats> {
  const dryRun = Boolean(options.dryRun);
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const stats: OrgsMembersEtlStats = {
    organizationsScanned: 0,
    organizationsUpserted: 0,
    membersScanned: 0,
    membersUpserted: 0,
    errors: [],
    dryRun,
  };

  if (!deps.isDbReady()) {
    stats.errors.push(
      "DATABASE_URL is not set (need nova_app runtime URL — see docs/ENVIRONMENTS.md).",
    );
    return stats;
  }
  if (!deps.isDocumentStoreReady()) {
    stats.errors.push(
      "Document store is not configured (FIREBASE_ADMIN_* env vars).",
    );
    return stats;
  }

  const log = options.onProgress ?? (() => undefined);

  for await (const orgId of deps.listOrganizationIds({
    organizationId: options.organizationId,
    pageSize,
    limit: options.limit,
  })) {
    stats.organizationsScanned += 1;
    try {
      const org = await deps.getOrganization(orgId);
      if (!org) {
        stats.errors.push(`organization missing after list: ${orgId}`);
        continue;
      }
      if (!dryRun) {
        await deps.upsertOrganization(org);
        stats.organizationsUpserted += 1;
      }
      log(
        `${dryRun ? "[dry-run] " : ""}org ${orgId} (${org.slug})`,
      );

      let members: OrganizationMember[];
      try {
        members = await deps.listMembers(orgId);
      } catch (err) {
        stats.errors.push(
          `members list failed for ${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      for (const member of members) {
        stats.membersScanned += 1;
        try {
          if (!dryRun) {
            await deps.upsertMember(member);
            stats.membersUpserted += 1;
          }
        } catch (err) {
          stats.errors.push(
            `member upsert failed ${orgId}/${member.uid}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      log(
        `${dryRun ? "[dry-run] " : ""}org ${orgId}: ${members.length} member(s)`,
      );
    } catch (err) {
      stats.errors.push(
        `organization failed ${orgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return stats;
}
