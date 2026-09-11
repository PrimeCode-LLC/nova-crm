/**
 * One-shot backfill: nested scheduledEmails docs → scheduled_emails table.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL=... npx tsx scripts/backfill-scheduled-emails.ts
 *
 * Idempotent: upserts by id. Safe to re-run.
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { Prisma } from "../src/generated/prisma/client";
import { getPrisma, disconnectPrisma } from "../src/lib/db/prisma";
import { withRlsBypass } from "../src/lib/db/tenant-scope";

type DocRow = {
  path: string;
  organizationId: string | null;
  payload: Record<string, unknown>;
};

function payloadOf(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function main(): Promise<void> {
  const prisma = getPrisma();
  const docs = await withRlsBypass(async (tx) =>
    tx.pgDocument.findMany({
      where: {
        path: { contains: "/scheduledEmails/" },
      },
      select: {
        path: true,
        organizationId: true,
        payload: true,
      },
    }),
  );

  let upserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of docs as DocRow[]) {
    const parts = doc.path.split("/").filter(Boolean);
    // organizations/{orgId}/members/{uid}/scheduledEmails/{id}
    const schIdx = parts.indexOf("scheduledEmails");
    if (schIdx < 0 || schIdx + 1 >= parts.length) {
      skipped += 1;
      continue;
    }
    const id = parts[schIdx + 1]!;
    const uid = parts[schIdx - 1] ?? "";
    const orgFromPath = parts[1] ?? "";
    const data = payloadOf(doc.payload);
    const organizationId = str(data.organizationId) || doc.organizationId || orgFromPath;
    const mailboxOwnerUid = str(data.uid) || uid;
    const mailboxId = str(data.mailboxId);
    const status = str(data.status) || "pending";
    const scheduledAtRaw = str(data.scheduledAt);
    const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
    if (!organizationId || !mailboxOwnerUid || !mailboxId || !scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      skipped += 1;
      continue;
    }

    const followupId = str(data.followupId) || null;
    const idempotencyKey = followupId || id;
    const payload = {
      body: str(data.body) || str(data.text),
      text: str(data.text) || str(data.body),
      html: str(data.html),
      cc: str(data.cc),
      bcc: str(data.bcc),
      replyTo: str(data.replyTo),
      displayName: str(data.displayName),
      attachments: data.attachments ?? [],
      ...(str(data.inReplyTo) ? { inReplyTo: str(data.inReplyTo) } : {}),
      ...(Array.isArray(data.referenceIds)
        ? { referenceIds: data.referenceIds.map(String).slice(-50) }
        : {}),
      ...(data.forceNewThread === true ? { forceNewThread: true } : {}),
      ...(str(data.nextRetryAt) ? { nextRetryAt: str(data.nextRetryAt) } : {}),
    };

    try {
      await withRlsBypass(async (tx) => {
        await tx.scheduledEmailRow.upsert({
          where: { id },
          create: {
            id,
            organizationId,
            mailboxOwnerUid,
            mailboxId,
            scheduledByUserId: str(data.scheduledByUserId) || null,
            followupId,
            leadId: str(data.leadId) || null,
            status,
            scheduledAt,
            notBeforeAt: str(data.notBeforeAt) ? new Date(str(data.notBeforeAt)) : null,
            attempts: Math.max(0, Number(data.attempts ?? 0) || 0),
            failureKind: str(data.failureKind) || null,
            idempotencyKey,
            toEmail: str(data.to) || "unknown@invalid",
            fromEmail: str(data.from) || "unknown@invalid",
            subject: str(data.subject) || "(no subject)",
            messageId: str(data.messageId) || null,
            sentAt: str(data.sentAt) ? new Date(str(data.sentAt)) : null,
            cancelledAt: str(data.cancelledAt) ? new Date(str(data.cancelledAt)) : null,
            cancelReason: str(data.cancelReason) || null,
            error: str(data.error) || null,
            lastSkipReason: str(data.lastSkipReason) || null,
            payload: payload as Prisma.InputJsonValue,
            createdAt: str(data.createdAt) ? new Date(str(data.createdAt)) : new Date(),
            updatedAt: new Date(),
          },
          update: {
            organizationId,
            mailboxOwnerUid,
            mailboxId,
            scheduledByUserId: str(data.scheduledByUserId) || null,
            followupId,
            leadId: str(data.leadId) || null,
            status,
            scheduledAt,
            notBeforeAt: str(data.notBeforeAt) ? new Date(str(data.notBeforeAt)) : null,
            attempts: Math.max(0, Number(data.attempts ?? 0) || 0),
            failureKind: str(data.failureKind) || null,
            idempotencyKey,
            toEmail: str(data.to) || "unknown@invalid",
            fromEmail: str(data.from) || "unknown@invalid",
            subject: str(data.subject) || "(no subject)",
            messageId: str(data.messageId) || null,
            sentAt: str(data.sentAt) ? new Date(str(data.sentAt)) : null,
            cancelledAt: str(data.cancelledAt) ? new Date(str(data.cancelledAt)) : null,
            cancelReason: str(data.cancelReason) || null,
            error: str(data.error) || null,
            lastSkipReason: str(data.lastSkipReason) || null,
            payload: payload as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
        });
      });
      upserted += 1;
    } catch (e) {
      errors += 1;
      console.error("[backfill] failed", { id, path: doc.path, error: e instanceof Error ? e.message : e });
    }
  }

  console.info("[backfill-scheduled-emails]", {
    scanned: docs.length,
    upserted,
    skipped,
    errors,
  });
  void prisma;
  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectPrisma().catch(() => null);
  process.exit(1);
});
