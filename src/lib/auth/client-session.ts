"use client";

import { getFirebaseAuth } from "@/lib/firebase/client";

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

  if (data.needsClaimRefresh) {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (user) {
      const fresh = await user.getIdToken(true);
      const re = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: fresh }),
      });
      if (!re.ok) {
        const body = (await re.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Session refresh failed (${re.status})`);
      }
      const refreshed = (await re.json()) as ExchangeResult;
      return {
        organizationId: refreshed.organizationId,
        orgRole: refreshed.orgRole,
        membershipPending: refreshed.membershipPending,
      };
    }
  }

  return {
    organizationId: data.organizationId,
    orgRole: data.orgRole,
    membershipPending: data.membershipPending,
  };
}
