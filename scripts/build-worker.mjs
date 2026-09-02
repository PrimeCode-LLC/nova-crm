/**
 * Bundle the worker entrypoint for Dockerfile.worker (`dist/worker/index.mjs`).
 *
 * Must be ESM: Prisma 7's generated client calls
 * `fileURLToPath(import.meta.url)`. esbuild's CJS format replaces
 * `import.meta` with `{}`, which throws:
 *   The "path" argument must be of type string or an instance of URL. Received undefined
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "dist/worker/index.mjs");

await esbuild.build({
  entryPoints: [path.join(root, "src/worker/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile,
  packages: "external",
  alias: {
    "@": path.join(root, "src"),
  },
  logLevel: "info",
});

const bundled = fs.readFileSync(outfile, "utf8");
if (
  bundled.includes("import_meta = {}") ||
  /fileURLToPath\(\s*import_meta\.url\s*\)/.test(bundled)
) {
  console.error(
    "[build:worker] refused: bundle still empties import.meta.url (Prisma would crash at runtime)",
  );
  process.exit(1);
}

console.info("[build:worker] wrote", outfile);
