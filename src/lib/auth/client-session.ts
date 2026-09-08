"use client";

import { reload, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { readAppClaims } from "@/lib/auth/claims";

export type ExchangeResult = {
  organizationId: string | null;
  orgRole: string | null;
  membershipPending?: boolean;
};

/**
 * Exchanges a Firebase ID token for an httpOnly session cookie.
 *
 * On fresh signups (or invite acceptance) the server stamps new custom claims.
 * The cookie minted from the *original* token doesn't carry those claims, so
 * we force a client-side ID-token refresh and re-exchange. After the second
 * call returns, the session cookie embeds the latest `organizationId` and
 * `orgRole` claims and the client SDK token also carries them.
 */
export async function exchangeIdTokenForSession(
  idToken: string,
  options?: { company?: string; inviteToken?: string; openJoinToken?: string },
): Promise<ExchangeResult> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idToken,
      company: options?.company,
      inviteToken: options?.inviteToken,
      openJoinToken: options?.openJoinToken,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Session failed (${res.status})`);
  }
  const data = (await res.json()) as ExchangeResult & {
    needsClaimRefresh?: boolean;
  };

  const auth = getFirebaseAuth();
  const user = auth.currentUser;

  if (data.needsClaimRefresh && user) {
    const fresh = await user.getIdToken(true);
    const re = await fetch("/api/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: fresh }),
    });
    if (!re.ok) {
      const body = (await re.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Session refresh failed (${re.status})`);
    }
    const refreshed = (await re.json()) as ExchangeResult;
    await user.getIdToken(true);
    return {
      organizationId: refreshed.organizationId,
      orgRole: refreshed.orgRole,
      membershipPending: refreshed.membershipPending,
    };
  }

  if (user && data.organizationId) {
    await user.getIdToken(true);
  }

  return {
    organizationId: data.organizationId,
    orgRole: data.orgRole,
    membershipPending: data.membershipPending,
  };
}

type AuthMeBody = {
  user?: { uid?: string; organizationId?: string; orgRole?: string } | null;
  isPlatformAdmin?: boolean;
  membershipPending?: boolean;
  pendingOrganizationName?: string | null;
  backupOnlyMode?: boolean;
};

/** In-flight dedupe so Strict Mode / multiple mount effects share one `/api/auth/me`. */
let authMeInflight: Promise<AuthMeBody | null> | null = null;

export async function fetchAuthMe(): Promise<AuthMeBody | null> {
  if (authMeInflight) return authMeInflight;
  authMeInflight = (async () => {
    try {
      const meRes = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
      if (!meRes.ok) return null;
      return (await meRes.json()) as AuthMeBody;
    } catch {
      return null;
    } finally {
      authMeInflight = null;
    }
  })();
  return authMeInflight;
}

/**
 * After login or on app load, align the Firebase client ID token with custom
 * claims stamped by `/api/auth/session` (rules read `users/{uid}.organizationId`
 * first, but other clients still benefit from a fresh token).
 */
export async function syncFirebaseAuthClaimsClient(user: User): Promise<void> {
  try {
    const body = await fetchAuthMe();
    if (!body) return;
    const expectedOrg = body.user?.organizationId;
    if (!expectedOrg) return;
    const token = await user.getIdTokenResult(false);
    const claims = readAppClaims(token.claims as Record<string, unknown>);
    const orgMismatch = claims.organizationId !== expectedOrg;
    const roleMismatch = Boolean(
      body.user?.orgRole && claims.orgRole !== body.user.orgRole,
    );
    if (orgMismatch || roleMismatch) {
      await refreshServerSessionFromCurrentUser(user);
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * After Firebase credential changes (e.g. password update), forces user reload +
 * fresh ID token and exchanges for a new httpOnly session cookie. Retries handle
 * races right after refresh-token rotation.
 */
export async function refreshServerSessionFromCurrentUser(
  user: User,
): Promise<ExchangeResult> {
  await reload(user);
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
    try {
      const idToken = await user.getIdToken(true);
      return await exchangeIdTokenForSession(idToken);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("Session refresh failed");
}
