/**
 * Guards against worker-bundle regressions:
 * 1) Prisma empty import.meta.url (CJS)
 * 2) Nodemailer Dynamic require via esbuild __require shim (ESM)
 *
 * Run after `npm run build:worker`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

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
assert.ok(
  !bundled.includes('__require("nodemailer'),
  'worker bundle must not __require("nodemailer...")',
);
assert.ok(
  !bundled.includes("Dynamic require of \"nodemailer"),
  "worker bundle must not embed nodemailer Dynamic require shim",
);
assert.ok(
  /from\s+["']nodemailer(?:\/[^"']*)?["']/.test(bundled),
  "worker bundle must external-import nodemailer (or a nodemailer subpath)",
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

// Runtime: deep CJS path must load from node_modules (as the worker image does).
const req = createRequire(pathToFileURL(path.join(root, "package.json")).href);
const MailComposer = req("nodemailer/lib/mail-composer");
assert.equal(typeof MailComposer, "function", "nodemailer/lib/mail-composer must be constructible");

console.log("validate-worker-bundle: OK");
