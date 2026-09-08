/**
 * Export effective AI prompts as a platform prompts pack.
 *
 * Reads overrides from one org's Firestore `aiPrompts` (current storage),
 * fills gaps from code defaults. Intended as the global prompts source until
 * prompts move to a true platform store.
 *
 * Usage:
 *   npx --yes tsx scripts/export-prompts-pack.ts --org=YOUR_ORG_ID
 *   npx --yes tsx scripts/export-prompts-pack.ts --org=YOUR_ORG_ID --out=archives/knowledge
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
    console.error("Usage: npx tsx scripts/export-prompts-pack.ts --org=ORG_ID [--out=DIR]");
    process.exit(1);
  }

  const outDir = resolve(root, argValue("--out") ?? "archives/knowledge");

  const { exportPromptsPackFromStore } = await import(
    "../src/lib/ai/knowledge-pack-export-server"
  );
  const { slugifyOrgForFilename } = await import("../src/lib/ai/knowledge-pack-build");

  const pack = await exportPromptsPackFromStore({ organizationId: orgId });
  const slug = slugifyOrgForFilename(pack.sourceOrganizationName ?? pack.sourceOrganizationId);
  const filePath = join(outDir, `${slug}.prompts-pack.json`);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");

  console.log("Wrote", filePath);
  console.log("Counts:", pack.counts);
  console.log(
    "Note: prompts are treated as platform-global on import; sourceOrganizationId is informational.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
