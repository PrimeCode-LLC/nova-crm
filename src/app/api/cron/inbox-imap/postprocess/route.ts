import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import {
  runInboxImapPostprocessCronServer,
  type PostprocessMailbox,
} from "@/lib/email/inbox-imap-postprocess-cron-server";

export const maxDuration = 300;

/**
 * P1.2 companion to Cloud Functions IMAP head sync.
 * Applies bounce detection + lead-mail fanout from stored heads (no full head fetch).
 *
 * Body (optional JSON): `{ mailboxes: [{ organizationId, uid, mailboxId }] }`
 * When omitted or empty, returns ok with zero work (scheduler always sends the list).
 */
export async function POST(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const started = Date.now();
  try {
    let mailboxes: PostprocessMailbox[] = [];
    try {
      const body = (await req.json()) as { mailboxes?: PostprocessMailbox[] };
      if (Array.isArray(body.mailboxes)) {
        mailboxes = body.mailboxes.filter(
          (m) =>
            m &&
            typeof m.organizationId === "string" &&
            typeof m.uid === "string" &&
            typeof m.mailboxId === "string",
        );
      }
    } catch {
      mailboxes = [];
    }

    // Cap per request so a bad payload cannot monopolize App Hosting.
    const capped = mailboxes.slice(0, 12);
    const result = await runInboxImapPostprocessCronServer(capped);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "inbox-imap postprocess completed",
        ...result,
        ms: Date.now() - started,
      }),
    );
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "inbox-imap postprocess failed",
        error,
        ms: Date.now() - started,
      }),
    );
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
