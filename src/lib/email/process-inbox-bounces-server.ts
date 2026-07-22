import type { MailInbound } from "@/lib/email-account-types";
import {
  detectHardBounce,
  isDeliveryStatusNotification,
} from "@/lib/email/detect-hard-bounce";
import { applyEmailBounceServer } from "@/lib/email/apply-email-bounce-server";
import { fetchImapBodiesServer } from "@/lib/email/imap-fetch-bodies-server";

/** Cap DSN body downloads per mailbox per cron tick (cost). */
const MAX_DSN_BODIES_PER_MAILBOX = 20;

export type ProcessInboxBouncesResult = {
  candidates: number;
  applied: number;
  alreadyProcessed: number;
  skipped: number;
  failed: number;
};

/**
 * After cron head sync: detect DSN candidates from envelopes, fetch bodies,
 * and idempotently apply hard/soft bounce CRM side effects.
 */
export async function processInboxBouncesFromHeadsServer(input: {
  organizationId: string;
  /** Mailbox owner uid (bounce ledger + secrets). */
  dataOwnerUid: string;
  mailboxId: string;
  messages: MailInbound[];
  imap: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    accessToken?: string;
  };
}): Promise<ProcessInboxBouncesResult> {
  const result: ProcessInboxBouncesResult = {
    candidates: 0,
    applied: 0,
    alreadyProcessed: 0,
    skipped: 0,
    failed: 0,
  };

  const candidates = input.messages.filter((m) => isDeliveryStatusNotification(m));
  result.candidates = candidates.length;
  if (candidates.length === 0) return result;

  const toFetch = candidates.slice(0, MAX_DSN_BODIES_PER_MAILBOX);
  let bodyByUid = new Map<number, Awaited<ReturnType<typeof fetchImapBodiesServer>>[number]>();

  try {
    const updates = await fetchImapBodiesServer({
      host: input.imap.host,
      port: input.imap.port,
      secure: input.imap.secure,
      user: input.imap.user,
      pass: input.imap.pass,
      accessToken: input.imap.accessToken,
      folder: "inbox",
      uids: toFetch.map((m) => m.uid),
      maxUids: MAX_DSN_BODIES_PER_MAILBOX,
    });
    bodyByUid = new Map(updates.map((u) => [u.uid, u]));
  } catch {
    // Without bodies we can still try envelope-only detection (usually incomplete).
  }

  for (const head of toFetch) {
    const body = bodyByUid.get(head.uid);
    const message: MailInbound = body
      ? {
          ...head,
          preview: body.preview || head.preview,
          bodyText: body.bodyText,
          bodyHtml: body.bodyHtml,
          ...(body.cc ? { cc: body.cc } : {}),
          ...(body.replyTo ? { replyTo: body.replyTo } : {}),
          ...(body.messageId ? { messageId: body.messageId } : {}),
          ...(body.inReplyTo ? { inReplyTo: body.inReplyTo } : {}),
          ...(body.referenceIds?.length ? { referenceIds: body.referenceIds } : {}),
          bodySynced: body.bodySynced,
        }
      : head;

    const bounce = detectHardBounce(message);
    if (!bounce) {
      result.skipped += 1;
      continue;
    }

    // Incomplete hard bounce — wait for a later tick / body parse.
    if (
      bounce.bounceKind === "hard" &&
      bounce.failedRecipients.length === 0 &&
      !bounce.originalMessageId
    ) {
      result.skipped += 1;
      continue;
    }

    try {
      const applied = await applyEmailBounceServer({
        organizationId: input.organizationId,
        actorUid: input.dataOwnerUid,
        dataOwnerUid: input.dataOwnerUid,
        mailboxId: input.mailboxId,
        inboundMessageId: String(head.id),
        bounceKind: bounce.bounceKind,
        failedRecipients: bounce.failedRecipients,
        originalMessageId: bounce.originalMessageId,
        reason: bounce.reason,
        subject: message.subject,
      });
      if (!applied.ok) {
        result.failed += 1;
        continue;
      }
      if (applied.alreadyProcessed || applied.skippedSoft) {
        result.alreadyProcessed += 1;
      } else {
        result.applied += 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  // Candidates beyond the body-fetch cap wait for a later tick (still in head window).
  result.skipped += Math.max(0, candidates.length - toFetch.length);

  return result;
}
