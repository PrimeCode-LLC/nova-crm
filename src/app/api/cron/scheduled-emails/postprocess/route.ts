import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import {
  runScheduledEmailPostprocessCronServer,
  type ScheduledEmailPostprocessItem,
} from "@/lib/email/scheduled-email-postprocess-cron-server";

export const maxDuration = 120;

/**
 * P1.3 companion to Cloud Functions scheduled SMTP send.
 * Lead-mail + reply-intel for messages already marked sent on Functions.
 */
export async function POST(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const started = Date.now();
  try {
    let items: ScheduledEmailPostprocessItem[] = [];
    try {
      const body = (await req.json()) as { sent?: ScheduledEmailPostprocessItem[] };
      if (Array.isArray(body.sent)) {
        items = body.sent.filter(
          (m) =>
            m &&
            typeof m.organizationId === "string" &&
            typeof m.uid === "string" &&
            typeof m.mailboxId === "string" &&
            typeof m.scheduledEmailId === "string",
        );
      }
    } catch {
      items = [];
    }

    const result = await runScheduledEmailPostprocessCronServer(items);
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
