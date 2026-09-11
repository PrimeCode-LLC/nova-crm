/**
 * Import scriptLibrary JSONL (from ops/export-firestore-script-library.mjs)
 * into Postgres pg_documents via the document shim.
 *
 * Usage (from repo root, DATABASE_URL / MIGRATE pointing at target DB):
 *   npx tsx scripts/import-script-library-archive.ts --file=archives/.../scriptLibrary.jsonl
 *   npx tsx scripts/import-script-library-archive.ts --file=... --dry-run
 *   npx tsx scripts/import-script-library-archive.ts --file=... --org=AYyMtDLz4FbLPiHnh5g2
 *   npx tsx scripts/import-script-library-archive.ts --file=... --remap-org=OLD:NEW
 *
 * Idempotent upserts by document path (scriptLibrary/{id}).
 */

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
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

type ArchiveLine = {
  id?: string;
  path?: string;
  data?: Record<string, unknown>;
};

const SCRIPT_CATEGORIES = new Set([
  "pitch",
  "rebuttal",
  "email_template",
  "call_script",
  "meeting_agenda",
  "followup_template",
  "other",
]);

function normalizePayload(
  id: string,
  raw: Record<string, unknown>,
  remapOrg?: { from: string; to: string },
): Record<string, unknown> {
  let organizationId = String(raw.organizationId ?? "");
  if (remapOrg && organizationId === remapOrg.from) {
    organizationId = remapOrg.to;
  }

  const primaryText = String(raw.primaryText ?? raw.content ?? "");
  const secondaryText =
    typeof raw.secondaryText === "string" ? raw.secondaryText : "";
  const category = SCRIPT_CATEGORIES.has(String(raw.category))
    ? String(raw.category)
    : "other";
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  return {
    organizationId,
    ownerUid: String(raw.ownerUid ?? ""),
    ownerName: typeof raw.ownerName === "string" ? raw.ownerName : "",
    title: String(raw.title ?? "").trim() || `Script ${id}`,
    category,
    primaryText,
    secondaryText,
    content:
      String(raw.content ?? "").trim() ||
      [primaryText, secondaryText].filter(Boolean).join("\n\n"),
    tags,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

async function main() {
  loadEnvLocal();

  const fileArg = argValue("--file");
  if (!fileArg) {
    console.error(
      "Usage: npx tsx scripts/import-script-library-archive.ts --file=archives/.../scriptLibrary.jsonl [--dry-run] [--org=ID] [--remap-org=OLD:NEW]",
    );
    process.exit(1);
  }

  const filePath = resolve(root, fileArg);
  if (!existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const filterOrg = argValue("--org");
  const remapRaw = argValue("--remap-org");
  const remapOrg =
    remapRaw && remapRaw.includes(":")
      ? {
          from: remapRaw.slice(0, remapRaw.indexOf(":")).trim(),
          to: remapRaw.slice(remapRaw.indexOf(":") + 1).trim(),
        }
      : undefined;

  console.log("Import scriptLibrary archive", {
    filePath,
    dryRun,
    filterOrg: filterOrg ?? "(any)",
    remapOrg: remapOrg ?? null,
  });

  const { getAdminDb } = await import("../src/lib/db/document-access/admin");
  const { disconnectPrisma } = await import("../src/lib/db/prisma");
  const { COLLECTIONS } = await import("../src/lib/documents/collections");

  const db = getAdminDb();
  if (!db && !dryRun) {
    console.error("Database not configured (DATABASE_URL).");
    process.exit(1);
  }

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let read = 0;
  let upserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    read += 1;
    let parsed: ArchiveLine;
    try {
      parsed = JSON.parse(trimmed) as ArchiveLine;
    } catch (err) {
      errors.push(`line ${read}: invalid JSON (${String(err)})`);
      continue;
    }

    const id = String(parsed.id ?? "").trim();
    if (!id || !parsed.data || typeof parsed.data !== "object") {
      errors.push(`line ${read}: missing id/data`);
      skipped += 1;
      continue;
    }

    const payload = normalizePayload(id, parsed.data, remapOrg);
    if (filterOrg && payload.organizationId !== filterOrg) {
      skipped += 1;
      continue;
    }
    if (!payload.organizationId) {
      errors.push(`line ${read} id=${id}: missing organizationId`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      upserted += 1;
      continue;
    }

    try {
      await db!.collection(COLLECTIONS.scriptLibrary).doc(id).set(payload);
      upserted += 1;
      if (upserted % 25 === 0) {
        console.log(`… upserted ${upserted}`);
      }
    } catch (err) {
      errors.push(`id=${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const stats = { read, upserted, skipped, errors: errors.length };
  console.log("Done:", stats);
  if (errors.length > 0) {
    console.error("Errors (first 20):");
    for (const e of errors.slice(0, 20)) console.error(" ", e);
    process.exitCode = 1;
  }

  await disconnectPrisma().catch(() => undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
