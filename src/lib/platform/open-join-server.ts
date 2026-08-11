import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

/** 32 bytes url-safe - entropy for the secret segment of `orgId.secret`. */
export function generateOpenJoinSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashOpenJoinSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/** Composite token shared on the join link: `<orgId>.<secret>`. */
export function packOpenJoinToken(orgId: string, secret: string): string {
  return `${orgId}.${secret}`;
}

export function unpackOpenJoinToken(
  token: string,
): { orgId: string; secret: string } | null {
  const idx = token.indexOf(".");
  if (idx <= 0 || idx >= token.length - 1) return null;
  const orgId = token.slice(0, idx).trim();
  const secret = token.slice(idx + 1).trim();
  if (!orgId || !secret) return null;
  return { orgId, secret };
}

export async function verifyOpenJoinTokenServer(
  token: string,
): Promise<{ orgId: string } | null> {
  const parts = unpackOpenJoinToken(token.trim());
  if (!parts) return null;
  const org = await getOrganizationServer(parts.orgId);
  if (!org?.openJoinTokenHash) return null;
  if (hashOpenJoinSecret(parts.secret) !== org.openJoinTokenHash) return null;
  return { orgId: parts.orgId };
}

export async function setOrganizationOpenJoinHashServer(
  orgId: string,
  hash: string | null,
): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const cur = await ref.get();
  if (!cur.exists) return { error: "Organization not found" };
  if (hash === null) {
    await ref.update({
      openJoinTokenHash: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({
      openJoinTokenHash: hash,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const { mirrorOrganizationAfterWrite } = await import("@/lib/db/dual-write-orgs");
  await mirrorOrganizationAfterWrite(orgId);
  return { ok: true };
}
