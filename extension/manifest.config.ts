import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

export default defineManifest(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const novaOrigin = new URL(
    env.VITE_NOVA_BASE_URL ?? "http://localhost:3000",
  ).origin;
  return {
    manifest_version: 3,
    name: "Nova Intent Radar",
    version: "0.1.0",
    description: "Score visible web opportunities against your assigned Nova strategies.",
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    permissions: [
      "activeTab",
      "tabs",
      "scripting",
      "storage",
      "identity",
      "sidePanel",
      "contextMenus",
      "alarms",
    ],
    host_permissions: [`${novaOrigin}/*`, "http://*/*", "https://*/*"],
    externally_connectable: {
      matches: [`${novaOrigin}/*`],
    },
    background: {
      service_worker: "src/service-worker.ts",
      type: "module",
    },
    action: {
      default_title: "Open Nova Intent Radar",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
      },
    },
    side_panel: {
      default_path: "sidepanel.html",
    },
    content_scripts: [
      {
        // Capture text selection before the side panel steals focus.
        // Skip the Nova app itself (login / CRM) — nothing useful to scan there.
        matches: ["http://*/*", "https://*/*"],
        exclude_matches: [`${novaOrigin}/*`],
        js: ["src/selection-capture.ts"],
        run_at: "document_idle",
      },
    ],
    commands: {
      "scan-current-page": {
        suggested_key: {
          default: "Alt+Shift+N",
          mac: "Command+Shift+N",
        },
        description: "Scan the current page with Nova Intent Radar",
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    ...(env.VITE_EXTENSION_PUBLIC_KEY
      ? { key: env.VITE_EXTENSION_PUBLIC_KEY }
      : {}),
  };
});
