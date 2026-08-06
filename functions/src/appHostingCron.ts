import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

const cronSecret = defineSecret("CRON_SECRET");
const siteUrl = defineString("SITE_URL", {
  default: "https://nova.stellixsoft.com",
  description: "Public App Hosting origin (no trailing slash)",
});

async function callAppHostingCron(path: string, label: string): Promise<Record<string, unknown>> {
  const base = siteUrl.value().replace(/\/$/, "");
  const secret = cronSecret.value()?.trim();
  if (!secret) {
    throw new Error(`${label}: CRON_SECRET is not configured on Cloud Functions`);
  }

  const res = await fetch(`${base}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const bodyText = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch {
    body = { raw: bodyText.slice(0, 500) };
  }

  if (!res.ok) {
    throw new Error(`${label} failed (${res.status}): ${JSON.stringify(body)}`);
  }

  return body;
}

const cronScheduleOptions = {
  timeZone: "UTC",
  secrets: [cronSecret],
  timeoutSeconds: 540,
  memory: "512MiB" as const,
  minInstances: 0,
  maxInstances: 1,
};

/**
 * Stagger heavy App Hosting cron traffic so IMAP + scheduled-send + scrapers
 * never pile onto the same minute (shared maxInstances: 3 pool).
 * - IMAP heads: :00,:05,:10,...
 * - Scheduled send: :02,:07,:12,...
 * - Scrapers: :07,:22,:37,:52 (avoids :00/:15/:30/:45 pile-ups with the 5-min jobs)
 * Scraper tick remains ~every 15 minutes (matches minimum feed interval in settings).
 */
export const runDueScrapers = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "7-59/15 * * * *",
  },
  async () => {
    const result = await callAppHostingCron("/api/cron/scrapers/run", "Scraper cron");
    console.log(JSON.stringify({ level: "info", message: "Scraper cron ok", result }));
  },
);

/** Sends due scheduled outbound emails via App Hosting. */
export const sendDueScheduledEmails = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "2-59/5 * * * *",
  },
  async () => {
    const result = await callAppHostingCron(
      "/api/cron/scheduled-emails/send",
      "Scheduled email cron",
    );
    console.log(JSON.stringify({ level: "info", message: "Scheduled email cron ok", result }));
  },
);

/** Syncs IMAP inbox heads server-side so open browser tabs don't hammer IMAP. */
export const syncInboxImapHeads = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "*/5 * * * *",
    timeoutSeconds: 540,
    memory: "1GiB" as const,
  },
  async () => {
    const result = await callAppHostingCron("/api/cron/inbox-imap/sync", "Inbox IMAP cron");
    console.log(JSON.stringify({ level: "info", message: "Inbox IMAP cron ok", result }));
  },
);

/**
 * Hourly tick: App Hosting only notifies capturers when it is ~09:00 in each
 * organization's workspace timezone (see processContentCaptureRemindersServer).
 */
export const sendContentCaptureReminders = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "every 1 hours",
  },
  async () => {
    const result = await callAppHostingCron(
      "/api/cron/content-capture-reminders",
      "Content capture reminders cron",
    );
    console.log(
      JSON.stringify({ level: "info", message: "Content capture reminders cron ok", result }),
    );
  },
);
