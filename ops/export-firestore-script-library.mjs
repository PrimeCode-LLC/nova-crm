/**
 * One-time ETL: export Firestore `scriptLibrary` → local JSONL.
 *
 * Lives under ops/ (not src/scripts) so Phase 7 firebase-import CI gate stays clean.
 * Uses leftover or ad-hoc `firebase-admin` — do NOT add it to the app package.json.
 *
 * Usage (from repo root, with FIREBASE_ADMIN_* in .env.local):
 *   node ops/export-firestore-script-library.mjs --dry-run
 *   node ops/export-firestore-script-library.mjs --org=AYyMtDLz4FbLPiHnh5g2
 *   node ops/export-firestore-script-library.mjs --org=AYyMtDLz4FbLPiHnh5g2 --out=archives/scripts
 *
 * Exception: ENGINEERING_RULES § Firebase — read-only archive/ETL only; no new app dependency.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
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
    value = value.replace(/\\n/g, "\n");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function argValue(flag) {
  const prefix = `${flag}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

function serializeValue(value) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value;
    if (typeof v.toDate === "function") {
      try {
        const d = v.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
      } catch {
        /* fall through */
      }
    }
    if (typeof v._seconds === "number") {
      const ms = v._seconds * 1000 + Math.floor((Number(v._nanoseconds) || 0) / 1e6);
      return new Date(ms).toISOString();
    }
    if (Array.isArray(value)) return value.map(serializeValue);
    const out = {};
    for (const [k, child] of Object.entries(v)) {
      out[k] = serializeValue(child);
    }
    return out;
  }
  return String(value);
}

function initFirestore() {
  let admin;
  try {
    admin = require("firebase-admin");
  } catch {
    console.error(
      "firebase-admin is not installed. One-shot: npm i firebase-admin --no-save\n" +
        "(Do not add it to package.json — CI forbids app Firebase deps.)",
    );
    process.exit(1);
  }

  if (admin.apps.length === 0) {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
    if (!projectId || !clientEmail || !privateKey) {
      console.error("Missing FIREBASE_ADMIN_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY in .env.local");
      process.exit(1);
    }
    privateKey = privateKey.replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  return admin.firestore();
}

async function main() {
  loadEnvLocal();

  const dryRun = process.argv.includes("--dry-run");
  const orgId = argValue("--org");
  const limitRaw = Number(argValue("--limit") ?? "");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.resolve(
    root,
    argValue("--out") ?? path.join("archives", `firestore-scriptLibrary-${stamp}`),
  );

  console.log("Export Firestore scriptLibrary", {
    dryRun,
    organizationId: orgId ?? "(all)",
    limit: limit ?? "(none)",
    outDir: dryRun ? null : outDir,
  });

  const db = initFirestore();
  let query = db.collection("scriptLibrary").orderBy("__name__");
  if (orgId) {
    query = db
      .collection("scriptLibrary")
      .where("organizationId", "==", orgId)
      .orderBy("__name__");
  }

  const pageSize = 200;
  let docs = 0;
  let bytes = 0;
  let last = null;
  let stream = null;

  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
    stream = createWriteStream(path.join(outDir, "scriptLibrary.jsonl"), {
      encoding: "utf8",
    });
  }

  for (;;) {
    let q = query.limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = serializeValue(doc.data());
      const line =
        JSON.stringify({
          id: doc.id,
          path: doc.ref.path,
          data,
        }) + "\n";
      docs += 1;
      bytes += Buffer.byteLength(line);
      if (stream) {
        if (!stream.write(line)) {
          await new Promise((resolve) => stream.once("drain", resolve));
        }
      }
      if (limit != null && docs >= limit) {
        last = doc;
        break;
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (limit != null && docs >= limit) break;
    if (snap.size < pageSize) break;
  }

  if (stream) {
    stream.end();
    await finished(stream);
  }

  const manifest = {
    collection: "scriptLibrary",
    organizationId: orgId ?? null,
    dryRun,
    docs,
    bytes,
    exportedAt: new Date().toISOString(),
    outDir: dryRun ? null : outDir,
  };

  if (!dryRun) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      path.join(outDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }

  console.log(JSON.stringify(manifest, null, 2));
  if (docs === 0) {
    console.warn("No scriptLibrary documents found for this filter.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
