import crypto from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type {
  ISODate,
  OrganizationInvite,
  OrganizationInviteStatus,
  OrgMemberRole,
} from "@/lib/types";

const INVITE_TTL_DAYS = 7;

function tsToIso(t: Timestamp | undefined | null): ISODate {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

function maybeTsToIso(t: Timestamp | undefined | null): ISODate | undefined {
  if (!t || !t.toDate) return undefined;
  return t.toDate().toISOString();
}

function docToInvite(
  organizationId: string,
  id: string,
  data: DocumentData,
): OrganizationInvite {
  return {
    id,
    organizationId,
    email: String(data.email ?? "").toLowerCase(),
    role: (data.role as OrgMemberRole) ?? "member",
    tokenHash: String(data.tokenHash ?? ""),
    status: (data.status as OrganizationInviteStatus) ?? "pending",
    expiresAt: tsToIso(data.expiresAt as Timestamp | undefined),
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    createdByUid: String(data.createdByUid ?? ""),
    acceptedAt: maybeTsToIso(data.acceptedAt as Timestamp | undefined),
    acceptedByUid:
      typeof data.acceptedByUid === "string" ? data.acceptedByUid : undefined,
  };
}

function invitesCol(orgId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.invites);
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
  const col = invitesCol(orgId);
  if (!col) return [];
  const snap = await col.orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => docToInvite(orgId, d.id, d.data()));
}

export async function createInviteServer(input: {
  organizationId: string;
  email: string;
  role: OrgMemberRole;
  createdByUid: string;
}): Promise<
  { invite: OrganizationInvite; token: string } | { error: string }
> {
  const col = invitesCol(input.organizationId);
  if (!col) return { error: "Database not configured" };

  const email = input.email.trim().toLowerCase();
  if (!email) return { error: "Email is required" };

  // If a pending invite already exists for that email, revoke it before creating a new one.
  const existing = await col
    .where("email", "==", email)
    .where("status", "==", "pending")
    .get();
  for (const d of existing.docs) {
    await d.ref.update({
      status: "revoked",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const secret = generateInviteToken();
  const expiresAt = Timestamp.fromMillis(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const ref = col.doc();
  const payload = {
    email,
    role: input.role,
    tokenHash: hashInviteToken(secret),
    status: "pending" as const,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: input.createdByUid,
  };
  await ref.set(payload);
  const fresh = await ref.get();
  return {
    invite: docToInvite(input.organizationId, ref.id, fresh.data()!),
    token: packInviteToken(input.organizationId, ref.id, secret),
  };
}

export async function revokeInviteServer(
  orgId: string,
  inviteId: string,
): Promise<{ ok: true } | { error: string }> {
  const col = invitesCol(orgId);
  if (!col) return { error: "Database not configured" };
  const ref = col.doc(inviteId);
  const cur = await ref.get();
  if (!cur.exists) return { error: "Invite not found" };
  await ref.update({
    status: "revoked",
    updatedAt: FieldValue.serverTimestamp(),
  });
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

  const col = invitesCol(parts.orgId);
  if (!col) return { ok: false, reason: "not_found" };
  const d = await col.doc(parts.id).get();
  if (!d.exists) return { ok: false, reason: "not_found" };
  const invite = docToInvite(parts.orgId, d.id, d.data()!);

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
  const col = invitesCol(orgId);
  if (!col) return;
  await col.doc(inviteId).update({
    status: "accepted",
    acceptedAt: FieldValue.serverTimestamp(),
    acceptedByUid,
  });
}
