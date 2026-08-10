import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { runInboxImapHeadsSyncOnFunctions } from "./inboxImapSync";
import { runDueScheduledEmailsOnFunctions } from "./scheduledEmailSend";
import { runDueScrapersOnFunctions } from "./scrapersRun";

const cronSecret = defineSecret("CRON_SECRET");
/** Same 32-byte key App Hosting uses to decrypt mailbox vault docs. */
const emailSecretsKey = defineSecret("EMAIL_SECRETS_KEY_BASE64");

/**
 * Google OAuth for Workspace IMAP/SMTP (XOAUTH2). Prefer setting these as Functions
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

/**
 * Rollback: set SCHEDULED_EMAIL_RUNTIME=apphosting to restore full send on App Hosting.
 * Default `functions` keeps SMTP off the interactive web tier.
 */
const scheduledEmailRuntime = defineString("SCHEDULED_EMAIL_RUNTIME", {
  default: "functions",
  description:
    "functions = CF SMTP send + AH postprocess; apphosting = legacy full cron on SITE_URL",
});

/**
 * Rollback: set SCRAPERS_RUNTIME=apphosting to restore full scrape+cleanup on App Hosting.
 * Default `functions` keeps RSS fan-out off the interactive web tier.
 */
const scrapersRuntime = defineString("SCRAPERS_RUNTIME", {
  default: "functions",
  description:
    "functions = CF scrape+cleanup; apphosting = legacy full cron on SITE_URL",
});

function bindMailEnv(): void {
  process.env.EMAIL_SECRETS_KEY_BASE64 = emailSecretsKey.value();
  process.env.SITE_URL = siteUrl.value().replace(/\/$/, "");
  const mailId = googleMailClientId.value().trim();
  const mailSecret = googleMailClientSecret.value().trim();
  const calId = googleCalendarClientId.value().trim();
  const calSecret = googleCalendarClientSecret.value().trim();
  if (mailId) process.env.GOOGLE_MAIL_CLIENT_ID = mailId;
  if (mailSecret) process.env.GOOGLE_MAIL_CLIENT_SECRET = mailSecret;
  if (calId) process.env.GOOGLE_CALENDAR_CLIENT_ID = calId;
  if (calSecret) process.env.GOOGLE_CALENDAR_CLIENT_SECRET = calSecret;
}

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
 * Stagger heavy work across the hour:
 * - IMAP heads (CF): :00,:05,:10,... then light AH postprocess
 * - Scheduled send (CF): :02,:07,:12,... then light AH postprocess
 * - Scrapers (CF): :07,:22,:37,:52
 */
export const runDueScrapers = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "7-59/15 * * * *",
    timeoutSeconds: 540,
    memory: "1GiB" as const,
  },
  async () => {
    const runtime = scrapersRuntime.value().trim().toLowerCase() || "functions";

    if (runtime === "apphosting") {
      const result = await callAppHostingCron("/api/cron/scrapers/run", "Scraper cron");
      console.log(
        JSON.stringify({
          level: "info",
          message: "Scraper cron ok (legacy apphosting runtime)",
          result,
        }),
      );
      return;
    }

    const result = await runDueScrapersOnFunctions();
    console.log(
      JSON.stringify({
        level: "info",
        message: "Scraper cron ok (functions runtime)",
        result: {
          orgCount: result.orgCount,
          feedsRun: result.feedsRun,
          newItems: result.newItems,
          expiredDeleted: result.expiredDeleted,
          staleEpochDeleted: result.staleEpochDeleted,
        },
      }),
    );
  },
);

/** P1.3 — Due scheduled SMTP send on Cloud Functions; AH only postprocess. */
export const sendDueScheduledEmails = onSchedule(
  {
    ...cronScheduleOptions,
    schedule: "2-59/5 * * * *",
    timeoutSeconds: 540,
    memory: "1GiB" as const,
    secrets: [cronSecret, emailSecretsKey],
  },
  async () => {
    const runtime = scheduledEmailRuntime.value().trim().toLowerCase() || "functions";

    if (runtime === "apphosting") {
      const result = await callAppHostingCron(
        "/api/cron/scheduled-emails/send",
        "Scheduled email cron",
      );
      console.log(
        JSON.stringify({
          level: "info",
          message: "Scheduled email cron ok (legacy apphosting runtime)",
          result,
        }),
      );
      return;
    }

    bindMailEnv();
    const sendResult = await runDueScheduledEmailsOnFunctions();
    console.log(
      JSON.stringify({
        level: "info",
        message: "Scheduled email send ok (functions runtime)",
        result: {
          processed: sendResult.processed,
          sent: sendResult.sent,
          failed: sendResult.failed,
          skipped: sendResult.skipped,
        },
      }),
    );

    if (sendResult.sentItems.length > 0) {
      const post = await callAppHostingCron(
        "/api/cron/scheduled-emails/postprocess",
        "Scheduled email postprocess",
        { method: "POST", body: { sent: sendResult.sentItems } },
      );
      console.log(
        JSON.stringify({
          level: "info",
          message: "Scheduled email postprocess ok",
          result: post,
        }),
      );
    }
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

    bindMailEnv();
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
