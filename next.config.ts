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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
    ],
  },
};

export default nextConfig;
