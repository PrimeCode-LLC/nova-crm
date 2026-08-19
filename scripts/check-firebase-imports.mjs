#!/usr/bin/env node
/**
 * CI gate (Phase 7): Firebase packages and Cloud Functions must stay gone.
 * Remaining `firebase/*` / `firebase-admin/*` imports are path-aliased to
 * Postgres shims in `src/lib/db/pg-firestore/` (see tsconfig.json).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const FORBIDDEN_PATHS = [
  "functions",
  "firebase.json",
  "firestore.rules",
  "firestore.indexes.json",
  "firebase.emulator-test.json",
  "apphosting.yaml",
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

if (violations.length > 0) {
  console.error("Firebase removal gate failed:\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("Firebase removal gate passed (packages + config gone; imports alias to Postgres shims).");
