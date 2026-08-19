/**
 * Bundle the worker entrypoint for Dockerfile.worker (`dist/worker/index.js`).
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [path.join(root, "src/worker/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: path.join(root, "dist/worker/index.js"),
  packages: "external",
  alias: {
    "@": path.join(root, "src"),
    "firebase-admin/firestore": path.join(
      root,
      "src/lib/db/pg-firestore/shim-firestore.ts",
    ),
    "firebase-admin/app": path.join(root, "src/lib/db/pg-firestore/shim-app.ts"),
    "firebase-admin/auth": path.join(root, "src/lib/db/pg-firestore/shim-auth.ts"),
  },
  logLevel: "info",
});

console.info("[build:worker] wrote dist/worker/index.js");
