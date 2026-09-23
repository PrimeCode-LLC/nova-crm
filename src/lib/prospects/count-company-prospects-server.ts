import { Prisma } from "@/generated/prisma/client";

import { withOrganizationScope } from "@/lib/db/tenant-scope";

/**
 * Prospects for one company attributed to one researcher.
 * Actor precedence matches `countCompanyContactsForUser`:
 * scraperId, then createdById, then prospectOwnerId, then ownerId.
 * Rejected prospects are excluded. Domain match wins over company name.
 */
export async function countCompanyProspectsForActor(input: {
  organizationId: string;
  userId: string;
  companyDomain?: string;
  companyName?: string;
}): Promise<number> {
  const organizationId = input.organizationId.trim();
  const userId = input.userId.trim();
  const domain = input.companyDomain?.trim().toLowerCase() ?? "";
  const name = input.companyName?.trim().toLowerCase() ?? "";
  if (!organizationId || !userId || (!domain && !name)) return 0;

  const companyMatch = domain
    ? Prisma.sql`lower(COALESCE(payload->>'companyDomain', '')) = ${domain}`
    : Prisma.sql`lower(company_name) = ${name}`;

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM leads
      WHERE organization_id = ${organizationId}
        AND intake_kind = 'prospect'
        AND COALESCE(payload->>'prospectQualifyStatus', '') <> 'rejected'
        AND COALESCE(
          NULLIF(payload->>'scraperId', ''),
          NULLIF(payload->>'createdById', ''),
          NULLIF(payload->>'prospectOwnerId', ''),
          NULLIF(owner_id, '')
        ) = ${userId}
        AND ${companyMatch}
    `,
  );
  return Number(rows[0]?.count ?? 0);
}
