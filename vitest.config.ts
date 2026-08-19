import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "firebase-admin/firestore": `${root}/src/lib/db/pg-firestore/shim-firestore.ts`,
      "firebase-admin/app": `${root}/src/lib/db/pg-firestore/shim-app.ts`,
      "firebase-admin/auth": `${root}/src/lib/db/pg-firestore/shim-auth.ts`,
      "firebase/firestore": `${root}/src/lib/db/pg-firestore/shim-client-firestore.ts`,
      "firebase/app": `${root}/src/lib/db/pg-firestore/shim-client-app.ts`,
      "firebase/auth": `${root}/src/lib/db/pg-firestore/shim-client-auth.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
