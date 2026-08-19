import crypto from "node:crypto";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope, withRlsBypass } from "@/lib/db/tenant-scope";
import type {
  ISODate,
  OrganizationInvite,
  OrganizationInviteStatus,
  OrgMemberRole,
} from "@/lib/types";

const INVITE_TTL_DAYS = 7;

function toIso(d: Date | null | undefined): ISODate {
  return (d ?? new Date()).toISOString();
}

function rowToInvite(row: {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  tokenHash: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  createdByUid: string;
  acceptedAt: Date | null;
  acceptedByUid: string | null;
}): OrganizationInvite {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email.toLowerCase(),
    role: (row.role as OrgMemberRole) ?? "member",
    tokenHash: row.tokenHash,
    status: (row.status as OrganizationInviteStatus) ?? "pending",
    expiresAt: toIso(row.expiresAt),
    createdAt: toIso(row.createdAt),
    createdByUid: row.createdByUid,
    acceptedAt: row.acceptedAt ? toIso(row.acceptedAt) : undefined,
    acceptedByUid: row.acceptedByUid ?? undefined,
  };
}

export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** 32 bytes of url-safe randomness - short enough for an email link, plenty of entropy. */
export function generateInviteToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Composite token shared with the recipient: `<orgId>.<inviteId>.<secret>`. */
export function packInviteToken(
  orgId: string,
  id: string,
  secret: string,
): string {
  return `${orgId}.${id}.${secret}`;
}

export function unpackInviteToken(
  token: string,
): { orgId: string; id: string; secret: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [orgId, id, secret] = parts;
  if (!orgId || !id || !secret) return null;
  return { orgId, id, secret };
}

export async function listInvitesServer(
  orgId: string,
): Promise<OrganizationInvite[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await withOrganizationScope(orgId, (tx) =>
    tx.orgInvite.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    }),
  );
  return rows.map(rowToInvite);
}

export async function createInviteServer(input: {
  organizationId: string;
  email: string;
  role: OrgMemberRole;
  createdByUid: string;
}): Promise<
  { invite: OrganizationInvite; token: string } | { error: string }
> {
  if (!isDatabaseConfigured()) return { error: "Database not configured" };

  const email = input.email.trim().toLowerCase();
  if (!email) return { error: "Email is required" };

  const secret = generateInviteToken();
  const tokenHash = hashInviteToken(secret);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const id = crypto.randomUUID();

  const row = await withOrganizationScope(input.organizationId, async (tx) => {
    await tx.orgInvite.updateMany({
      where: {
        organizationId: input.organizationId,
        email,
        status: "pending",
      },
      data: { status: "revoked" },
    });
    return tx.orgInvite.create({
      data: {
        id,
        organizationId: input.organizationId,
        email,
        role: input.role,
        tokenHash,
        status: "pending",
        expiresAt,
        createdByUid: input.createdByUid,
      },
    });
  });

  return {
    invite: rowToInvite(row),
    token: packInviteToken(input.organizationId, row.id, secret),
  };
}

export async function revokeInviteServer(
  orgId: string,
  inviteId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured" };
  const updated = await withOrganizationScope(orgId, (tx) =>
    tx.orgInvite.updateMany({
      where: { id: inviteId, organizationId: orgId },
      data: { status: "revoked" },
    }),
  );
  if (updated.count === 0) return { error: "Invite not found" };
  return { ok: true };
}

export type LookupResult =
  | { ok: true; invite: OrganizationInvite }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "accepted" };

/**
 * Find an invite by its composite token. Used on the accept path.
 * Validates token hash, expiration, and status.
 */
export async function lookupInviteByTokenServer(
  token: string,
): Promise<LookupResult> {
  const parts = unpackInviteToken(token);
  if (!parts) return { ok: false, reason: "not_found" };
  if (!isDatabaseConfigured()) return { ok: false, reason: "not_found" };

  const row = await withRlsBypass((tx) =>
    tx.orgInvite.findUnique({ where: { id: parts.id } }),
  );
  if (!row || row.organizationId !== parts.orgId) {
    return { ok: false, reason: "not_found" };
  }
  const invite = rowToInvite(row);

  if (invite.tokenHash !== hashInviteToken(parts.secret)) {
    return { ok: false, reason: "not_found" };
  }
  if (invite.status === "revoked") return { ok: false, reason: "revoked" };
  if (invite.status === "accepted") return { ok: false, reason: "accepted" };
  if (Date.parse(invite.expiresAt) < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, invite };
}

export async function markInviteAcceptedServer(
  orgId: string,
  inviteId: string,
  acceptedByUid: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await withRlsBypass((tx) =>
    tx.orgInvite.updateMany({
      where: { id: inviteId, organizationId: orgId },
      data: {
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByUid,
      },
    }),
  );
}
