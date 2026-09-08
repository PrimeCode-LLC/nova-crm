/**
 * Export one organization's RAG knowledge pack (libraries, documents, brands, links).
 *
 * Usage (from crm/, with Firebase Admin env in .env.local or shell):
 *   npx --yes tsx scripts/export-knowledge-pack.ts --org=YOUR_ORG_ID
 *   npx --yes tsx scripts/export-knowledge-pack.ts --org=YOUR_ORG_ID --out=archives/knowledge
 *
 * Does not include prompts (use export-prompts-pack.ts) or provider secrets.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function argValue(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

async function main() {
  loadEnvLocal();

  const orgId = argValue("--org");
  if (!orgId) {
    console.error("Usage: npx tsx scripts/export-knowledge-pack.ts --org=ORG_ID [--out=DIR]");
    process.exit(1);
  }

  const outDir = resolve(root, argValue("--out") ?? "archives/knowledge");

  const { exportKnowledgePackFromFirestore } = await import(
    "../src/lib/ai/knowledge-pack-export-server"
  );
  const { slugifyOrgForFilename } = await import("../src/lib/ai/knowledge-pack-build");

  const pack = await exportKnowledgePackFromFirestore({ organizationId: orgId });
  const slug = slugifyOrgForFilename(pack.sourceOrganizationName ?? pack.sourceOrganizationId);
  const filePath = join(outDir, `${slug}.knowledge-pack.json`);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");

  console.log("Wrote", filePath);
  console.log("Counts:", pack.counts);
  if (pack.sourceOrganizationName) {
    console.log("Organization:", pack.sourceOrganizationName, `(${pack.sourceOrganizationId})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
