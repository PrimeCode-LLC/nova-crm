#!/usr/bin/env node
/**
 * CI gate (Phase 7): Firebase packages, config, and import strings must stay gone.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const FORBIDDEN_PATHS = [
  "functions",
  "firebase.json",
  "firestore.rules",
  "firestore.indexes.json",
  "firebase.emulator-test.json",
  "apphosting.yaml",
  "src/lib/firebase",
  "src/lib/firestore",
  "src/lib/db/pg-firestore",
];

const FORBIDDEN_PACKAGES = [
  "firebase",
  "firebase-admin",
  "firebase-tools",
  "@firebase/app",
  "@firebase/auth",
  "@firebase/firestore",
  "@firebase/rules-unit-testing",
];

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']firebase\//,
  /from\s+["']firebase-admin\//,
  /require\s*\(\s*["']firebase\//,
  /require\s*\(\s*["']firebase-admin\//,
];

const SCAN_DIRS = ["src", "scripts"];
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);

const violations = [];

for (const rel of FORBIDDEN_PATHS) {
  if (existsSync(join(ROOT, rel))) {
    violations.push(`forbidden path present: ${rel}`);
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
  const deps = pkg[section] ?? {};
  for (const name of FORBIDDEN_PACKAGES) {
    if (name in deps) {
      violations.push(`package.json ${section} includes ${name}`);
    }
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === "dist") continue;
      walk(abs);
      continue;
    }
    const ext = name.slice(name.lastIndexOf("."));
    if (!SCAN_EXT.has(ext)) continue;
    const text = readFileSync(abs, "utf8");
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.test(text)) {
        violations.push(
          `forbidden firebase import in ${relative(ROOT, abs)} (use @/lib/db/document-shim/*)`,
        );
        break;
      }
    }
  }
}

for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (existsSync(abs)) walk(abs);
}

if (violations.length > 0) {
  console.error("Firebase removal gate failed:\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(
  "Firebase removal gate passed (packages + config gone; Postgres document store only).",
);
