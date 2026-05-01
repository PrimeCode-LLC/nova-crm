export type WorkspaceMode = "demo" | "live";

export const WORKSPACE_MODE_COOKIE = "nova_workspace_mode";

/** Persist mode for 1 year (local preference). */
export const WORKSPACE_MODE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseWorkspaceMode(value: string | undefined): WorkspaceMode {
  return value === "live" ? "live" : "demo";
}
