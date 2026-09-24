"use client";

import * as React from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import {
  clearInviteTokens,
  NOVA_INVITE_STORAGE_KEY,
  NOVA_JOIN_STORAGE_KEY,
  peekInviteTokens,
} from "@/components/providers/clerk-invite-stash";

/**
 * After Clerk sign-in/up, consume stashed invite/join tokens via
 * `POST /api/auth/clerk-complete-membership` (marks invite accepted + upserts member).
 */
export function ClerkCompleteMembership() {
  const { isLoaded, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const inFlightRef = React.useRef(false);

  React.useEffect(() => {
    if (!isClerkAuthV1Enabled() || !isLoaded || !isSignedIn || inFlightRef.current) {
      return;
    }

    // Recover tokens from the URL if Clerk redirected with query still present.
    const inviteQ = searchParams.get("invite")?.trim();
    const joinQ = searchParams.get("join")?.trim();
    if (inviteQ) sessionStorage.setItem(NOVA_INVITE_STORAGE_KEY, inviteQ);
    if (joinQ) sessionStorage.setItem(NOVA_JOIN_STORAGE_KEY, joinQ);

    const { inviteToken, openJoinToken } = peekInviteTokens();
    if (!inviteToken && !openJoinToken) return;

    inFlightRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/auth/clerk-complete-membership", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(inviteToken ? { inviteToken } : {}),
            ...(openJoinToken ? { openJoinToken } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          membershipPending?: boolean;
          organizationId?: string | null;
        };
        if (cancelled) {
          inFlightRef.current = false;
          return;
        }
        if (!res.ok || !data.ok) {
          inFlightRef.current = false;
          toast.error(data.error || "Could not accept invite", {
            description: "Ask an admin to resend the invite, then try again.",
          });
          return;
        }
        clearInviteTokens();
        if (data.membershipPending) {
          window.location.replace("/join/pending");
          return;
        }
        toast.success("You're in the workspace");
        // Hard reload so server session + workspace pick up org membership.
        window.location.replace("/dashboard");
      } catch {
        if (cancelled) {
          inFlightRef.current = false;
          return;
        }
        inFlightRef.current = false;
        toast.error("Could not accept invite", {
          description: "Check your connection and try signing in again from the invite link.",
        });
      }
    })();

    return () => {
      cancelled = true;
      // Allow remount (Strict Mode / navigation) to retry while tokens remain.
      inFlightRef.current = false;
    };
  }, [isLoaded, isSignedIn, searchParams]);

  return null;
}
