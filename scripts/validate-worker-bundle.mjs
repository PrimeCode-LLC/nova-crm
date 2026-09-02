/**
 * Guards against regressing the worker CJS/import.meta.url Prisma crash.
 * Run after `npm run build:worker`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "dist/worker/index.mjs");

assert.ok(fs.existsSync(outfile), `missing ${outfile} — run npm run build:worker`);
const bundled = fs.readFileSync(outfile, "utf8");
assert.ok(
  !bundled.includes("import_meta = {}"),
  "worker bundle empties import.meta (CJS regression)",
);
assert.ok(
  bundled.includes("fileURLToPath(import.meta.url)"),
  "worker bundle must preserve Prisma fileURLToPath(import.meta.url)",
);

// Same TypeError production saw when import.meta.url was undefined.
let threw = false;
try {
  fileURLToPath(undefined);
} catch (err) {
  threw = true;
  assert.match(String(err.message), /path.*undefined/i);
}
assert.ok(threw, "expected fileURLToPath(undefined) to throw");

console.log("validate-worker-bundle: OK");
