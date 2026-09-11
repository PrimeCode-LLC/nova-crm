import { clerkClient, type User } from "@clerk/nextjs/server";
import {
  findMembershipByEmailServer,
  findMembershipForUserServer,
} from "@/lib/platform/members-server";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import type { AppSession } from "@/lib/auth/session-types";
import type { OrganizationMember, OrgMemberRole } from "@/lib/types";

export type ClerkIdentityResolution = AppSession & {
  clerkUserId: string;
  /** True when Nova uid came from externalId / email bridge (not raw Clerk id). */
  bridged: boolean;
};

function readMetaString(
  meta: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function clerkEmailFromUser(user: User): string | undefined {
  return clerkEmail(user);
}

function clerkEmail(user: User): string | undefined {
  return (
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    undefined
  )?.toLowerCase();
}

function clerkDisplayName(user: User, email?: string): string | undefined {
  const full =
    user.fullName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (email) return email.split("@")[0];
  return undefined;
}

function applyMembership(
  membership: OrganizationMember,
): Pick<AppSession, "uid" | "organizationId" | "orgRole"> {
  if (membership.status === "pending") {
    return {
      uid: membership.uid,
      organizationId: membership.organizationId,
      orgRole: undefined,
    };
  }
  return {
    uid: membership.uid,
    organizationId: membership.organizationId,
    orgRole: membership.role,
  };
}

/**
 * Map a Clerk user to Nova session fields.
 *
 * Order:
 * 1. `externalId` / publicMetadata.novaUid → membership by uid (only if email matches)
 * 2. Membership lookup by email (Postgres then Firestore)
 * 3. Fall back to Clerk user id (new user → onboarding)
 *
 * When email matches an existing member, best-effort syncs `externalId` +
 * publicMetadata so later requests skip the email lookup.
 *
 * Stale bridges (Clerk linked to someone else's Nova uid) are rejected when the
 * membership email does not match the Clerk primary email, then repaired via email.
 */
export async function resolveClerkIdentity(
  user: User,
): Promise<ClerkIdentityResolution> {
  const clerkUserId = user.id;
  const email = clerkEmail(user);
  const name = clerkDisplayName(user, email);
  const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;

  const externalId = user.externalId?.trim() || undefined;
  const metaUid = readMetaString(meta, "novaUid");
  const linkedUid = externalId || metaUid;

  let uid = clerkUserId;
  let organizationId = readMetaString(meta, "organizationId");
  let orgRole =
    typeof meta.orgRole === "string"
      ? (meta.orgRole as OrgMemberRole)
      : undefined;
  let bridged = false;
  let repairedLink = false;

  const membershipEmailOk = (membershipEmail: string | undefined): boolean => {
    if (!email) return true;
    if (!membershipEmail?.trim()) return true;
    return membershipEmail.trim().toLowerCase() === email;
  };

  const applyIfUsable = (membership: OrganizationMember): boolean => {
    if (membership.status !== "active" && membership.status !== "pending") {
      return false;
    }
    if (!membershipEmailOk(membership.email)) {
      return false;
    }
    const applied = applyMembership(membership);
    uid = applied.uid;
    organizationId = applied.organizationId;
    orgRole = applied.orgRole;
    bridged = true;
    return true;
  };

  if (linkedUid) {
    const byUid = await findMembershipForUserServer(linkedUid);
    if (byUid && applyIfUsable(byUid)) {
      // Linked uid is trustworthy for this Clerk email.
    } else if (email) {
      // Missing membership or email mismatch → resolve by Clerk email and repair link.
      const byEmail = await findMembershipByEmailServer(email);
      if (byEmail && applyIfUsable(byEmail)) {
        repairedLink = byEmail.uid !== linkedUid;
        await syncClerkBridge(clerkUserId, {
          novaUid: byEmail.uid,
          organizationId:
            byEmail.status === "active" ? byEmail.organizationId : undefined,
          orgRole: byEmail.status === "active" ? byEmail.role : undefined,
          previousExternalId: externalId,
        });
      }
    }
  } else if (email) {
    const byEmail = await findMembershipByEmailServer(email);
    if (byEmail && applyIfUsable(byEmail)) {
      await syncClerkBridge(clerkUserId, {
        novaUid: byEmail.uid,
        organizationId:
          byEmail.status === "active" ? byEmail.organizationId : undefined,
        orgRole: byEmail.status === "active" ? byEmail.role : undefined,
        previousExternalId: externalId,
      });
    }
  }

  // Keep metadata org claims fresh when we already have a bridge.
  if (
    bridged &&
    organizationId &&
    !repairedLink &&
    (organizationId !== readMetaString(meta, "organizationId") ||
      orgRole !== meta.orgRole ||
      (linkedUid && linkedUid !== uid))
  ) {
    await syncClerkBridge(clerkUserId, {
      novaUid: uid,
      organizationId,
      orgRole,
      previousExternalId: externalId,
    });
  }

  const platformAdmin = await isUserPlatformAdmin(uid, email);

  return {
    clerkUserId,
    uid,
    email,
    name,
    organizationId,
    orgRole,
    platformAdmin: platformAdmin || undefined,
    bridged,
  };
}

/** Look up a Clerk user by primary email (exact match, case-insensitive input). */
export async function findClerkUserByEmailServer(
  emailRaw: string,
): Promise<User | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return null;
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({
      emailAddress: [email],
      limit: 5,
    });
    return (
      data.find(
        (u) => clerkEmail(u)?.toLowerCase() === email,
      ) ?? null
    );
  } catch (err) {
    console.warn(
      "[clerk-identity] getUserList by email failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Resolve the Nova uid stored on platform/membership records for a Clerk user.
 * Prefers externalId / novaUid metadata, then membership by email, then Clerk id.
 */
export async function resolveNovaUidForClerkUser(user: User): Promise<string> {
  const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
  const externalId = user.externalId?.trim() || undefined;
  const metaUid = readMetaString(meta, "novaUid");
  const linkedUid = externalId || metaUid;
  const email = clerkEmail(user);

  if (linkedUid) {
    const byUid = await findMembershipForUserServer(linkedUid);
    const membershipEmail = byUid?.email?.trim().toLowerCase();
    const emailOk =
      !email || !membershipEmail || membershipEmail === email;
    if (byUid && emailOk) return linkedUid;
  }

  if (email) {
    const byEmail = await findMembershipByEmailServer(email);
    if (byEmail) return byEmail.uid;
  }

  return linkedUid || user.id;
}

/** Resolve Nova uid + Clerk id for an email, or null when no Clerk account exists. */
export async function resolveNovaUidByEmailServer(
  emailRaw: string,
): Promise<{ uid: string; clerkUserId: string; email: string } | null> {
  const user = await findClerkUserByEmailServer(emailRaw);
  if (!user) return null;
  const email = clerkEmail(user) ?? emailRaw.trim().toLowerCase();
  const uid = await resolveNovaUidForClerkUser(user);
  return { uid, clerkUserId: user.id, email };
}

/** Persist Nova uid / org claims onto the Clerk user (P5.2+). */
export async function syncClerkNovaClaims(
  clerkUserId: string,
  opts: {
    novaUid: string;
    organizationId?: string;
    orgRole?: OrgMemberRole;
    previousExternalId?: string;
    platformAdmin?: boolean;
  },
): Promise<void> {
  return syncClerkBridge(clerkUserId, opts);
}

async function syncClerkBridge(
  clerkUserId: string,
  opts: {
    novaUid: string;
    organizationId?: string;
    orgRole?: OrgMemberRole;
    previousExternalId?: string;
    platformAdmin?: boolean;
  },
): Promise<void> {
  try {
    const client = await clerkClient();
    if (opts.previousExternalId !== opts.novaUid) {
      try {
        await client.users.updateUser(clerkUserId, {
          externalId: opts.novaUid,
        });
      } catch (err) {
        console.warn(
          "[clerk-identity] externalId sync failed",
          err instanceof Error ? err.message : err,
        );
      }
    }
    await client.users.updateUserMetadata(clerkUserId, {
      publicMetadata: {
        novaUid: opts.novaUid,
        ...(opts.organizationId
          ? { organizationId: opts.organizationId }
          : {}),
        ...(opts.orgRole ? { orgRole: opts.orgRole } : {}),
        ...("platformAdmin" in opts
          ? { platformAdmin: opts.platformAdmin === true }
          : {}),
      },
    });
  } catch (err) {
    console.warn(
      "[clerk-identity] metadata sync failed",
      err instanceof Error ? err.message : err,
    );
  }
}
