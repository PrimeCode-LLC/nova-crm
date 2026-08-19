import type { NextConfig } from "next";

/**
 * Do not set `turbopack.root` to this app folder; it breaks Tailwind v4
 * `@import "tailwindcss"` (vercel/next.js#90307).
 *
 * If `next dev` slows the whole system: Next may infer Turbopack’s workspace root
 * from a lockfile **above** this repo (e.g. `~/Desktop/yarn.lock`) and then
 * watch far too many files. Rename/remove that unrelated lockfile, or clone the
 * app under a path with no ancestor lockfile, so the inferred root stays small.
 */
const nextConfig: NextConfig = {
  /** Required by root `Dockerfile` (standalone server.js + traced deps). P4.6. */
  output: "standalone",
  /** Postgres-backed shims replace Firebase packages (P7). */
  turbopack: {
    resolveAlias: {
      "firebase-admin/firestore": "./src/lib/db/pg-firestore/shim-firestore.ts",
      "firebase-admin/app": "./src/lib/db/pg-firestore/shim-app.ts",
      "firebase-admin/auth": "./src/lib/db/pg-firestore/shim-auth.ts",
      "firebase/firestore": "./src/lib/db/pg-firestore/shim-client-firestore.ts",
      "firebase/app": "./src/lib/db/pg-firestore/shim-client-app.ts",
      "firebase/auth": "./src/lib/db/pg-firestore/shim-client-auth.ts",
    },
  },
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    Object.assign(config.resolve.alias, {
      "firebase-admin/firestore": require("path").resolve(
        __dirname,
        "src/lib/db/pg-firestore/shim-firestore.ts",
      ),
      "firebase-admin/app": require("path").resolve(
        __dirname,
        "src/lib/db/pg-firestore/shim-app.ts",
      ),
      "firebase-admin/auth": require("path").resolve(
        __dirname,
        "src/lib/db/pg-firestore/shim-auth.ts",
      ),
      "firebase/firestore": require("path").resolve(
        __dirname,
        "src/lib/db/pg-firestore/shim-client-firestore.ts",
      ),
      "firebase/app": require("path").resolve(
        __dirname,
        "src/lib/db/pg-firestore/shim-client-app.ts",
      ),
      "firebase/auth": require("path").resolve(
        __dirname,
        "src/lib/db/pg-firestore/shim-client-auth.ts",
      ),
    });
    return config;
  },
  /** Temporarily surface readable component names in production error stacks while we diagnose runtime crashes (React #185). Safe to remove once stable. */
  productionBrowserSourceMaps: true,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "recharts",
      "@tanstack/react-table",
      "@base-ui/react",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
    ],
  },
  // Email-stack packages are CommonJS with Node-only deps (iconv-lite, native-ish
  // CJS chains). Turbopack can't bundle them for server routes - externalize so
  // they're require()'d at runtime from node_modules instead.
  serverExternalPackages: [
    "mailparser",
    "@zone-eu/mailsplit",
    "imapflow",
    "nodemailer",
    "iconv-lite",
    "html-to-text",
    "libmime",
    "encoding-japanese",
  ],
};

export default nextConfig;
