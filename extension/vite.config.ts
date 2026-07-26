import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    // Keep sourcemaps off: @crxjs wraps content scripts in an IIFE and can
    // append `})()` onto the `//# sourceMappingURL=...` line, which comments
    // out the closer and causes Chrome `Unexpected end of input`.
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
