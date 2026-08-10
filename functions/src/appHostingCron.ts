import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { runInboxImapHeadsSyncOnFunctions } from "./inboxImapSync";

const cronSecret = defineSecret("CRON_SECRET");
/** Same 32-byte key App Hosting uses to decrypt mailbox vault docs. */
const emailSecretsKey = defineSecret("EMAIL_SECRETS_KEY_BASE64");

/**
 * Google OAuth for Workspace IMAP (XOAUTH2). Prefer setting these as Functions
 * params to match App Hosting env. Mail-specific overrides optional.
 */
const googleMailClientId = defineString("GOOGLE_MAIL_CLIENT_ID", { default: "" });
const googleMailClientSecret = defineString("GOOGLE_MAIL_CLIENT_SECRET", { default: "" });
const googleCalendarClientId = defineString("GOOGLE_CALENDAR_CLIENT_ID", { default: "" });
const googleCalendarClientSecret = defineString("GOOGLE_CALENDAR_CLIENT_SECRET", {
  default: "",
});

const siteUrl = defineString("SITE_URL", {
  default: "https://nova.stellixsoft.com",
  description: "Public App Hosting origin (no trailing slash)",
});

/**
 * Rollback: set IMAP_SYNC_RUNTIME=apphosting to restore the pre-P1.2 proxy
 * (full IMAP head sync on App Hosting). Default `functions` keeps IMAP off the web tier.
 */
const imapSyncRuntime = defineString("IMAP_SYNC_RUNTIME", {
  default: "functions",
  description:
    "functions = CF heads sync + AH postprocess; apphosting = legacy full cron on SITE_URL",
});

async function callAppHostingCron(
  path: string,
  label: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<Record<string, unknown>> {
  const base = siteUrl.value().replace(/\/$/, "");
  const secret = cronSecret.value()?.trim();
  if (!secret) {
    throw new Error(`${label}: CRON_SECRET is not configured on Cloud Functions`);
  }

  const method = init?.method ?? "GET";
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  let body: string | undefined;
  if (method === "POST" && init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body,
  });

  const bodyText = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: bodyText.slice(0, 500) };
  }

  if (!res.ok) {
    throw new Error(`${label} failed (${res.status}): ${JSON.stringify(parsed)}`);
  }

  return parsed;
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
 * Stagger heavy App Hosting cron traffic so IMAP postprocess + scheduled-send + scrapers
 * never pile onto the same minute (shared maxInstances: 3 pool).
 * - IMAP heads (Cloud Functions): :00,:05,:10,... then light AH postprocess
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

/**
 * P1.2 — IMAP head sync on Cloud Functions (separate Cloud Run from App Hosting).
 * Then App Hosting only runs bounce/fanout postprocess from stored heads.
 */
export const syncInboxImapHeads = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "*/5 * * * *",
    timeoutSeconds: 540,
    memory: "1GiB" as const,
    secrets: [cronSecret, emailSecretsKey],
  },
  async () => {
    const runtime = imapSyncRuntime.value().trim().toLowerCase() || "functions";

    if (runtime === "apphosting") {
      const result = await callAppHostingCron("/api/cron/inbox-imap/sync", "Inbox IMAP cron");
      console.log(
        JSON.stringify({
          level: "info",
          message: "Inbox IMAP cron ok (legacy apphosting runtime)",
          result,
        }),
      );
      return;
    }

    // Bind secrets / params into process.env for the in-process IMAP worker.
    process.env.EMAIL_SECRETS_KEY_BASE64 = emailSecretsKey.value();
    const mailId = googleMailClientId.value().trim();
    const mailSecret = googleMailClientSecret.value().trim();
    const calId = googleCalendarClientId.value().trim();
    const calSecret = googleCalendarClientSecret.value().trim();
    if (mailId) process.env.GOOGLE_MAIL_CLIENT_ID = mailId;
    if (mailSecret) process.env.GOOGLE_MAIL_CLIENT_SECRET = mailSecret;
    if (calId) process.env.GOOGLE_CALENDAR_CLIENT_ID = calId;
    if (calSecret) process.env.GOOGLE_CALENDAR_CLIENT_SECRET = calSecret;

    const heads = await runInboxImapHeadsSyncOnFunctions();
    console.log(
      JSON.stringify({
        level: "info",
        message: "Inbox IMAP heads sync ok (functions runtime)",
        result: heads,
      }),
    );

    if (heads.syncedMailboxes.length > 0) {
      const post = await callAppHostingCron(
        "/api/cron/inbox-imap/postprocess",
        "Inbox IMAP postprocess",
        { method: "POST", body: { mailboxes: heads.syncedMailboxes } },
      );
      console.log(
        JSON.stringify({
          level: "info",
          message: "Inbox IMAP postprocess ok",
          result: post,
        }),
      );
    }
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
