import { formatTimezoneDisplayLabel, getBrowserTimezone } from "@/lib/org-timezone";

/** localStorage key used by the old Settings → Account timezone text field. */
export const LS_ACCOUNT_SETTINGS = "nova-crm-settings-account-v1";

/** Select value for “use each person’s browser clock” (stored as empty string). */
export const BROWSER_TZ_VALUE = "__browser__";

export type WorkspaceTimezoneSide = "account" | "organization";

export function normalizeWorkspaceTimezone(tz?: string | null): string {
  return tz?.trim() ?? "";
}

export function workspaceTimezonesDiffer(a?: string | null, b?: string | null): boolean {
  return normalizeWorkspaceTimezone(a) !== normalizeWorkspaceTimezone(b);
}

export function formatWorkspaceTimezoneChoice(tz?: string | null, at: Date = new Date()): string {
  const value = normalizeWorkspaceTimezone(tz);
  if (!value) {
    return `Each person's browser timezone (${formatTimezoneDisplayLabel(getBrowserTimezone(), at)})`;
  }
  return formatTimezoneDisplayLabel(value, at);
}

export function readLegacyAccountTimezone(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_ACCOUNT_SETTINGS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { timezone?: unknown };
    if (typeof parsed.timezone !== "string") return null;
    const tz = parsed.timezone.trim();
    return tz || null;
  } catch {
    return null;
  }
}

export function clearLegacyAccountTimezone(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LS_ACCOUNT_SETTINGS);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!("timezone" in parsed)) return;
    delete parsed.timezone;
    if (Object.keys(parsed).length === 0) {
      localStorage.removeItem(LS_ACCOUNT_SETTINGS);
      return;
    }
    localStorage.setItem(LS_ACCOUNT_SETTINGS, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}
