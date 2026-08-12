"use client";

import * as React from "react";
import {
  onAuthStateChanged,
  signInWithCustomToken,
  type User,
} from "firebase/auth";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { exchangeIdTokenForSession } from "@/lib/auth/client-session";
import {
  WORKSPACE_MODE_COOKIE,
  WORKSPACE_MODE_MAX_AGE,
} from "@/lib/workspace-mode";
import { readAndClearInviteTokens } from "@/components/providers/clerk-invite-stash";

/**
 * When the user is signed into Clerk but not Firebase, mint a custom token
 * and sign into Firebase so Firestore live listeners keep working (P5 parallel).
 */
export function ClerkFirebaseBridge() {
  if (!isClerkAuthV1Enabled()) return null;
  return <ClerkFirebaseBridgeInner />;
}

function ClerkFirebaseBridgeInner() {
  const { isSignedIn, userId, isLoaded } = useClerkAuth();
  const [fbUser, setFbUser] = React.useState<User | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const inFlightRef = React.useRef(false);
  const lastUidRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isFirebaseWebConfigured()) {
      setFbUser(null);
      return;
    }
    const unsub = onAuthStateChanged(getFirebaseAuth(), (u) => setFbUser(u));
    return () => unsub();
  }, []);

  React.useEffect(() => {
    if (!isFirebaseWebConfigured()) return;
    if (!isLoaded || fbUser === undefined) return;
    if (!isSignedIn || !userId) return;
    if (fbUser) {
      lastUidRef.current = null;
      return;
    }
    if (inFlightRef.current) return;
    if (lastUidRef.current === userId) return;

    let cancelled = false;
    inFlightRef.current = true;

    void (async () => {
      try {
        setError(null);
        const res = await fetch("/api/auth/clerk-firebase-bridge", {
          method: "POST",
          credentials: "include",
        });
        const data = (await res.json().catch(() => ({}))) as {
          token?: string;
          error?: string;
        };
        if (!res.ok || !data.token) {
          if (!cancelled) {
            setError(
              data.error ??
                "Could not link Clerk to Firebase for live CRM data.",
            );
          }
          lastUidRef.current = userId;
          return;
        }

        const credential = await signInWithCustomToken(
          getFirebaseAuth(),
          data.token,
        );
        const idToken = await credential.user.getIdToken();
        await exchangeIdTokenForSession(idToken);

        const tokens = readAndClearInviteTokens();
        let nextPath = "/dashboard";
        if (tokens.inviteToken || tokens.openJoinToken) {
          const complete = await fetch("/api/auth/clerk-complete-membership", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tokens),
          });
          const body = (await complete.json().catch(() => ({}))) as {
            error?: string;
            membershipPending?: boolean;
            organizationId?: string | null;
          };
          if (!complete.ok) {
            throw new Error(body.error ?? "Could not accept invite.");
          }
          if (body.membershipPending) nextPath = "/join/pending";
          else if (!body.organizationId) nextPath = "/onboarding";
        }

        document.cookie = `${WORKSPACE_MODE_COOKIE}=live; path=/; max-age=${WORKSPACE_MODE_MAX_AGE}; samesite=lax`;

        if (!cancelled) {
          lastUidRef.current = userId;
          window.location.assign(nextPath);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Firebase custom-token sign-in failed.",
          );
          lastUidRef.current = userId;
        }
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [isLoaded, isSignedIn, userId, fbUser]);

  if (!error) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[100] max-w-md -translate-x-1/2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg"
    >
      <p className="font-medium">Live CRM link incomplete</p>
      <p className="mt-1 text-xs text-destructive/90">{error}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Sign in to Clerk with the same email as your Nova member, then refresh.
      </p>
    </div>
  );
}
