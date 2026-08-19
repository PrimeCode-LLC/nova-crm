/**
 * Backfill missing CRM profiles (roleId, computed permissions) for workspace members.
 *
 * Usage (from repo root, with Admin env loaded):
 *   npm run db:backfill:crm-profiles -- --dry-run
 *   npm run db:backfill:crm-profiles -- --org=YOUR_ORG_ID
 *
 * Requires DATABASE_URL and Postgres member list.
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/db/document-access/admin";
import { listMembersServer } from "../src/lib/platform/members-server";
import { backfillOrgCrmProfilesServer } from "../src/lib/platform/crm-profile-provision";
import { listOrganizationsServer } from "../src/lib/platform/organizations-server";
import { disconnectPrisma } from "../src/lib/db/prisma";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const organizationId = orgArg ? orgArg.slice("--org=".length).trim() : undefined;
  return { dryRun, organizationId };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = getAdminDb();
  if (!db) {
    console.error("Firebase Admin is not configured.");
    process.exit(1);
  }

  const orgIds = opts.organizationId
    ? [opts.organizationId]
    : (await listOrganizationsServer()).map((o) => o.id);

  console.log("CRM profile backfill", { dryRun: opts.dryRun, orgCount: orgIds.length });

  let totalProvisioned = 0;
  let totalSkipped = 0;

  for (const orgId of orgIds) {
    const members = await listMembersServer(orgId);
    if (opts.dryRun) {
      const active = members.filter((m) => m.status === "active");
      console.log(`[dry-run] org=${orgId} activeMembers=${active.length}`);
      continue;
    }

    const summary = await backfillOrgCrmProfilesServer(db, orgId, members, {
      forceRoleSync: true,
    });
    totalProvisioned += summary.provisioned;
    totalSkipped += summary.skipped;
    console.log(
      `org=${orgId} provisioned=${summary.provisioned} skipped=${summary.skipped} total=${summary.total}`,
    );
  }

  if (!opts.dryRun) {
    console.log("Done.", { totalProvisioned, totalSkipped });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
