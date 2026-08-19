/** firebase-admin/app shim — no Firebase dependency. */

export type App = { name: string };

let app: App | null = null;

export function getApps(): App[] {
  return app ? [app] : [];
}

export function initializeApp(_config?: unknown): App {
  app = { name: "[DEFAULT]" };
  return app;
}

export function cert(_credentials: unknown): unknown {
  return {};
}

export function getApp(): App {
  if (!app) app = { name: "[DEFAULT]" };
  return app;
}
