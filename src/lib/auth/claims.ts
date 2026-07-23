import type { Auth } from "firebase-admin/auth";
import type { OrgMemberRole } from "@/lib/types";

/**
 * Custom claims attached to Firebase ID tokens. Read by Firestore security
 * rules (`request.auth.token.organizationId`) and by `getVerifiedSession`.
 *
 * Keep this object SMALL - every claim costs JWT bytes on every request.
 */
export type AppClaims = {
  /** Tenant id this user belongs to. Absent until the user has joined or created an org. */
  organizationId?: string;
  /** Member role inside the org. */
  orgRole?: OrgMemberRole;
  /** Mirrors `platformAdmins` - convenience for the rules layer. */
  platformAdmin?: boolean;
};

const CLAIM_KEYS: ReadonlyArray<keyof AppClaims> = [
  "organizationId",
  "orgRole",
  "platformAdmin",
];

/**
 * Replace just the app-controlled claim keys, preserving any third-party claims
 * (e.g. set by Firebase Auth providers).
 */
export async function setAppClaims(
  adminAuth: Auth,
  uid: string,
  patch: AppClaims,
): Promise<void> {
  const user = await adminAuth.getUser(uid);
  const existing = (user.customClaims ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...existing };
  for (const key of CLAIM_KEYS) {
    const value = patch[key];
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  await adminAuth.setCustomUserClaims(uid, next);
}

export function readAppClaims(
  decoded: Record<string, unknown> | undefined | null,
): AppClaims {
  if (!decoded) return {};
  const out: AppClaims = {};
  if (typeof decoded.organizationId === "string") {
    out.organizationId = decoded.organizationId;
  }
  if (typeof decoded.orgRole === "string") {
    out.orgRole = decoded.orgRole as OrgMemberRole;
  }
  if (typeof decoded.platformAdmin === "boolean") {
    out.platformAdmin = decoded.platformAdmin;
  }
  return out;
}
