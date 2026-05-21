/** Must match `LS_NOTIFS` in `app/(app)/settings/page.tsx`. */
export const LS_USER_NOTIFICATION_SETTINGS = "nova-crm-settings-notifications-v1";

export type UserNotificationSettings = {
  emailNotifs: boolean;
  slackNotifs: boolean;
  leadAssigned: boolean;
  dailyDigest: boolean;
  weeklyScorecard: boolean;
  /** In-app chime for new mail, team chat, and CRM notifications. */
  soundAlerts: boolean;
};

export const DEFAULT_USER_NOTIFICATION_SETTINGS: UserNotificationSettings = {
  emailNotifs: true,
  slackNotifs: false,
  leadAssigned: true,
  dailyDigest: true,
  weeklyScorecard: false,
  soundAlerts: true,
};

export function readUserNotificationSettings(): UserNotificationSettings {
  if (typeof window === "undefined") return { ...DEFAULT_USER_NOTIFICATION_SETTINGS };
  try {
    const raw = localStorage.getItem(LS_USER_NOTIFICATION_SETTINGS);
    if (!raw) return { ...DEFAULT_USER_NOTIFICATION_SETTINGS };
    const j = JSON.parse(raw) as Partial<UserNotificationSettings>;
    return { ...DEFAULT_USER_NOTIFICATION_SETTINGS, ...j };
  } catch {
    return { ...DEFAULT_USER_NOTIFICATION_SETTINGS };
  }
}

export function isSoundAlertsEnabled(): boolean {
  return readUserNotificationSettings().soundAlerts;
}
