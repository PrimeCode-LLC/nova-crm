"use client";

import * as React from "react";

export const NOVA_INVITE_STORAGE_KEY = "nova_invite_token";
export const NOVA_JOIN_STORAGE_KEY = "nova_join_token";

/** Persist invite/join tokens across Clerk hosted redirects. */
export function ClerkInviteStash({
  invite,
  join,
}: {
  invite?: string;
  join?: string;
}) {
  React.useEffect(() => {
    if (invite) sessionStorage.setItem(NOVA_INVITE_STORAGE_KEY, invite);
    if (join) sessionStorage.setItem(NOVA_JOIN_STORAGE_KEY, join);
  }, [invite, join]);
  return null;
}

export function readAndClearInviteTokens(): {
  inviteToken?: string;
  openJoinToken?: string;
} {
  if (typeof window === "undefined") return {};
  const inviteToken =
    sessionStorage.getItem(NOVA_INVITE_STORAGE_KEY)?.trim() || undefined;
  const openJoinToken =
    sessionStorage.getItem(NOVA_JOIN_STORAGE_KEY)?.trim() || undefined;
  if (inviteToken) sessionStorage.removeItem(NOVA_INVITE_STORAGE_KEY);
  if (openJoinToken) sessionStorage.removeItem(NOVA_JOIN_STORAGE_KEY);
  return { inviteToken, openJoinToken };
}
