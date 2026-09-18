import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { disconnectPrisma, getPrisma, isDatabaseConfigured } from "@/lib/db/prisma";

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("no DATABASE_URL");
    process.exit(1);
  }
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<
    Array<{ organization_id: string; collection_root: string; n: number }>
  >`
    SELECT organization_id, collection_root, count(*)::int AS n
    FROM pg_documents
    WHERE organization_id IS NOT NULL
    GROUP BY 1, 2
    ORDER BY n DESC
    LIMIT 20
  `;
  console.log(JSON.stringify(rows, null, 2));
  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
