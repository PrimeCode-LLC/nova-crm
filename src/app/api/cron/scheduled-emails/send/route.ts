import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { processDueScheduledEmailsServer } from "@/lib/email/scheduled-emails-server";

/**
 * Legacy / rollback path: full due scheduled-email send on App Hosting.
 *
 * Production (P1.3+) runs SMTP on Cloud Functions (`sendDueScheduledEmails`) and
 * only calls `/api/cron/scheduled-emails/postprocess` here. Set Functions param
 * `SCHEDULED_EMAIL_RUNTIME=apphosting` to restore this route as the scheduled target.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const result = await processDueScheduledEmailsServer();
  return NextResponse.json({ ok: true, ...result });
}
