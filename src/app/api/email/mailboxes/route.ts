import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  deleteMailboxForMemberServer,
  getEmailAccountMetaServer,
  listMailboxesAssignedToViewerServer,
  listMailboxesForMemberServer,
  upsertMailboxWithSecretsMerged,
} from "@/lib/email/mailbox-profiles-server";
import { resolveMailboxDataOwnerUid, mailboxReadOnlyForClient } from "@/lib/email/mailbox-data-owner-server";
import { mergeOwnAndAssignedMailboxes } from "@/lib/email/merge-own-and-assigned-mailboxes";
import { getMailboxSendCountForDayServer, sendDayKey } from "@/lib/email/mailbox-send-quota-server";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { normalizeCrmEmailKey } from "@/lib/crm-dedup-keys";

const mailboxSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  enabled: z.boolean(),
  displayName: z.string(),
  emailAddress: z.string(),
  replyTo: z.string(),
  smtp: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    user: z.string(),
    password: z.string(),
  }),
  imap: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    user: z.string(),
    password: z.string(),
  }),
  signature: z.string(),
  syncIntervalMinutes: z.number(),
  archiveOnSend: z.boolean(),
  readReceipts: z.boolean(),
  trackClicks: z.boolean().optional().default(false),
  connectionType: z.enum(["google_workspace", "microsoft_outlook", "custom"]).optional().default("custom"),
  dailySendLimit: z.number().int().positive().nullable().optional().default(null),
  sendGapSeconds: z.number().int().min(0).nullable().optional().default(null),
  assignedUserIds: z.array(z.string()).optional().default([]),
  dataOwnerUid: z.string().optional(),
});

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const forUser = url.searchParams.get("forUser");
  const includeSecrets = url.searchParams.get("includeSecrets") === "1";
  const includeUsage = url.searchParams.get("includeUsage") === "1";
  // Default lite: boot hydrate should not pull per-message maps (main-thread freeze risk).
  // Pass includeMaps=1 when Inbox / lead linking needs the full meta doc.
  const includeMaps = url.searchParams.get("includeMaps") === "1";
  const lite = !includeMaps;

  const resolved = await resolveMailboxDataOwnerUid({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    viewerRole: g.ctx.role,
    forUserParam: forUser,
  });
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }

  const { organizationId, uid: viewerUid } = g.ctx.session;
  const { dataOwnerUid } = resolved;
  const mergeAssigned = dataOwnerUid === viewerUid && resolved.viewerIsMailboxOwner;

  const [ownMailboxes, meta, assigned, timeZone] = await Promise.all([
    listMailboxesForMemberServer({
      organizationId,
      uid: dataOwnerUid,
      includeSecrets,
    }),
    getEmailAccountMetaServer({ organizationId, uid: dataOwnerUid, lite }),
    mergeAssigned
      ? listMailboxesAssignedToViewerServer({ organizationId, viewerUid })
      : Promise.resolve([]),
    getOrgTimezoneServer(organizationId),
  ]);

  const mailboxes = mergeAssigned
    ? mergeOwnAndAssignedMailboxes(ownMailboxes, assigned)
    : ownMailboxes;

  const dayKey = sendDayKey(new Date(), timeZone);
  const sendUsageByMailboxId: Record<string, { dayKey: string; used: number; limit: number | null }> = {};
  if (includeUsage) {
    await Promise.all(
      mailboxes.map(async (mb) => {
        const ownerUid = mb.dataOwnerUid?.trim() || dataOwnerUid;
        const used = await getMailboxSendCountForDayServer({
          organizationId,
          uid: ownerUid,
          mailboxId: mb.id,
          dayKey,
          timeZone,
        });
        sendUsageByMailboxId[mb.id] = {
          dayKey,
          used,
          limit: mb.dailySendLimit,
        };
      }),
    );
  }

  return NextResponse.json({
    ok: true,
    dataOwnerUid,
    mailboxReadOnly: mailboxReadOnlyForClient(resolved),
    mailboxAccountReadOnly: !resolved.viewerIsMailboxOwner,
    mailboxes,
    sendUsageByMailboxId,
    activeMailboxId: meta.activeMailboxId,
    linkedLeadByMessageId: meta.linkedLeadByMessageId,
    blockedSenderDomains: meta.blockedSenderDomains,
    globalEmailFooter: meta.globalEmailFooter,
    mailLabels: meta.mailLabels,
    labelsByMessageId: meta.labelsByMessageId,
    flagByMessageId: meta.flagByMessageId,
  });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = z.object({ mailbox: mailboxSchema }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid mailbox payload" }, { status: 400 });
  }

  const { organizationId, uid } = g.ctx.session;
  const { dataOwnerUid: payloadOwner, ...mailboxRest } = parsed.data.mailbox;
  if (payloadOwner?.trim() && payloadOwner.trim() !== uid) {
    return NextResponse.json(
      {
        ok: false,
        error: "This mailbox is assigned from a teammate. Only the owner can change its settings.",
      },
      { status: 403 },
    );
  }
  const assigned = await listMailboxesAssignedToViewerServer({
    organizationId,
    viewerUid: uid,
  });
  if (
    assigned.some(
      (m) =>
        m.id === mailboxRest.id ||
        (normalizeCrmEmailKey(m.emailAddress) &&
          normalizeCrmEmailKey(m.emailAddress) === normalizeCrmEmailKey(mailboxRest.emailAddress)),
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "This mailbox is assigned from a teammate. Only the owner can change its settings.",
      },
      { status: 403 },
    );
  }
  const emailKey = normalizeCrmEmailKey(mailboxRest.emailAddress);
  if (emailKey) {
    const existing = await listMailboxesForMemberServer({
      organizationId,
      uid,
      includeSecrets: false,
    });
    const duplicate = existing.find(
      (m) => m.id !== mailboxRest.id && normalizeCrmEmailKey(m.emailAddress) === emailKey,
    );
    if (duplicate) {
      return NextResponse.json(
        {
          ok: false,
          error: `This email is already added on “${duplicate.label?.trim() || duplicate.emailAddress.trim() || "another mailbox"}”.`,
        },
        { status: 409 },
      );
    }
  }
  const result = await upsertMailboxWithSecretsMerged({
    organizationId,
    uid,
    mailbox: {
      ...mailboxRest,
      connectionType: mailboxRest.connectionType ?? "custom",
      dailySendLimit: mailboxRest.dailySendLimit ?? null,
      sendGapSeconds: mailboxRest.sendGapSeconds ?? null,
      trackClicks: mailboxRest.trackClicks ?? false,
      assignedUserIds: mailboxRest.assignedUserIds ?? [],
    },
  });
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const singleId = url.searchParams.get("mailboxId")?.trim() ?? "";
  let mailboxIds: string[] = [];

  if (singleId) {
    mailboxIds = [singleId];
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const raw =
      body &&
      typeof body === "object" &&
      Array.isArray((body as { mailboxIds?: unknown }).mailboxIds)
        ? (body as { mailboxIds: unknown[] }).mailboxIds
        : [];
    mailboxIds = [
      ...new Set(
        raw
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
  }

  if (mailboxIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "mailboxId or mailboxIds is required" },
      { status: 400 },
    );
  }

  /** Keep request time bounded for large cleanup sweeps. */
  const MAX_BULK_DELETE = 80;
  if (mailboxIds.length > MAX_BULK_DELETE) {
    return NextResponse.json(
      {
        ok: false,
        error: `At most ${MAX_BULK_DELETE} mailboxes can be deleted per request.`,
      },
      { status: 400 },
    );
  }

  const { organizationId, uid } = g.ctx.session;
  const deletedIds: string[] = [];
  const errors: Array<{ mailboxId: string; error: string }> = [];

  /** Parallel deletes stay under typical request time for large cleanup sweeps. */
  const CONCURRENCY = 8;
  for (let i = 0; i < mailboxIds.length; i += CONCURRENCY) {
    const slice = mailboxIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (mailboxId) => {
        const result = await deleteMailboxForMemberServer({ organizationId, uid, mailboxId });
        return { mailboxId, result };
      }),
    );
    for (const { mailboxId, result } of results) {
      if ("error" in result) {
        errors.push({ mailboxId, error: result.error });
        continue;
      }
      deletedIds.push(mailboxId);
    }
  }

  if (deletedIds.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: errors[0]?.error ?? "Could not delete mailboxes",
        deletedIds,
        errors,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    deletedIds,
    errors: errors.length > 0 ? errors : undefined,
  });
}
