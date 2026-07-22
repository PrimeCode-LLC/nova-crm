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
 * Wakes App Hosting to run due RSS scrapers (respects per-feed interval + enabled flag in Firestore).
 * Tick is every 15 minutes — matches the minimum minute interval in scraper settings.
 */
export const runDueScrapers = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "every 15 minutes",
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
    schedule: "every 5 minutes",
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
    schedule: "every 5 minutes",
    timeoutSeconds: 540,
    memory: "1GiB" as const,
  },
  async () => {
    const result = await callAppHostingCron("/api/cron/inbox-imap/sync", "Inbox IMAP cron");
    console.log(JSON.stringify({ level: "info", message: "Inbox IMAP cron ok", result }));
  },
);
