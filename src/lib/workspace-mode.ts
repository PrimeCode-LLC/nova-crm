export type WorkspaceMode = "demo" | "live";

export const WORKSPACE_MODE_COOKIE = "nova_workspace_mode";

/** Persist mode for 1 year (local preference). */
export const WORKSPACE_MODE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Parse the workspace mode cookie.
 * Unset / unknown → **live** (authenticated CRM default). Demo only when
 * explicitly `"demo"` so hard refresh does not flash the sample persona.
 */
export function parseWorkspaceMode(value: string | undefined): WorkspaceMode {
  return value === "demo" ? "demo" : "live";
}
