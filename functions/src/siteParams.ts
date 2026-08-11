/**
 * Shared Cloud Functions params (SITE_URL, CRON_SECRET).
 * Imported by cron + P3.4 org dashboard notify paths.
 */

import { defineSecret, defineString } from "firebase-functions/params";

export const cronSecret = defineSecret("CRON_SECRET");

export const siteUrl = defineString("SITE_URL", {
  default: "https://nova.stellixsoft.com",
  description: "Public App Hosting origin (no trailing slash)",
});
