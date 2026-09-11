"use client";

import * as React from "react";

export const NOVA_INVITE_STORAGE_KEY = "nova_invite_token";
export const NOVA_JOIN_STORAGE_KEY = "nova_join_token";

function stashToken(key: string, value: string | undefined) {
  if (typeof window === "undefined") return;
  const trimmed = value?.trim();
  if (trimmed) sessionStorage.setItem(key, trimmed);
}

/** Persist invite/join tokens across Clerk hosted redirects. */
export function ClerkInviteStash({
  invite,
  join,
}: {
  invite?: string;
  join?: string;
}) {
  // Write during render so a Clerk forceRedirect does not race past useEffect.
  stashToken(NOVA_INVITE_STORAGE_KEY, invite);
  stashToken(NOVA_JOIN_STORAGE_KEY, join);

  React.useEffect(() => {
    stashToken(NOVA_INVITE_STORAGE_KEY, invite);
    stashToken(NOVA_JOIN_STORAGE_KEY, join);
  }, [invite, join]);
  return null;
}

export function peekInviteTokens(): {
  inviteToken?: string;
  openJoinToken?: string;
} {
  if (typeof window === "undefined") return {};
  const inviteToken =
    sessionStorage.getItem(NOVA_INVITE_STORAGE_KEY)?.trim() || undefined;
  const openJoinToken =
    sessionStorage.getItem(NOVA_JOIN_STORAGE_KEY)?.trim() || undefined;
  return { inviteToken, openJoinToken };
}

export function clearInviteTokens(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(NOVA_INVITE_STORAGE_KEY);
  sessionStorage.removeItem(NOVA_JOIN_STORAGE_KEY);
}

/** @deprecated Prefer peek + clear after a successful accept. */
export function readAndClearInviteTokens(): {
  inviteToken?: string;
  openJoinToken?: string;
} {
  const tokens = peekInviteTokens();
  clearInviteTokens();
  return tokens;
}
