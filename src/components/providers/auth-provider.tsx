"use client";

import * as React from "react";
import {
  onAuthStateChanged,
  signOut as clientSignOut,
  type User,
} from "@/lib/db/document-shim/shim-client-auth";
import { isClientDocumentSyncEnabled } from "@/lib/db/document-access/config";
import { getClientAuth } from "@/lib/db/document-access/client";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import { syncClientAuthClaims } from "@/lib/auth/client-session";
import { AuthSessionSync } from "@/components/providers/auth-session-sync";
import { ClerkSignOutBridge } from "@/components/providers/clerk-sign-out-bridge";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

type ClerkSignOutFn = (opts?: { redirectUrl?: string }) => Promise<void>;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const clerkSignOutRef = React.useRef<ClerkSignOutFn | null>(null);

  React.useEffect(() => {
    if (isAuthDisabled() || !isClientDocumentSyncEnabled()) {
      setUser(null);
      setLoading(false);
      return;
    }

    const auth = getClientAuth();
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        setUser(u);
        setLoading(false);
        if (u) void syncClientAuthClaims(u);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const signOut = React.useCallback(async () => {
    const clerkEnabled = isClerkAuthV1Enabled();
    const afterPath = clerkEnabled ? "/sign-in" : "/login";

    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }

    if (isClientDocumentSyncEnabled()) {
      try {
        await clientSignOut(getClientAuth());
      } catch {
        /* ignore */
      }
    }

    // Clerk keeps its own cookies (__client / __session). Must sign out or
    // proxy will still see a Clerk userId and bounce back to /dashboard.
    if (clerkEnabled && clerkSignOutRef.current) {
      try {
        await clerkSignOutRef.current({ redirectUrl: afterPath });
        return;
      } catch {
        /* fall through to hard navigation */
      }
    }

    window.location.href = afterPath;
  }, []);

  const value = React.useMemo(
    () => ({ user, loading, signOut }),
    [user, loading, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {isClerkAuthV1Enabled() ? (
        <ClerkSignOutBridge
          register={(fn) => {
            clerkSignOutRef.current = fn;
          }}
        />
      ) : null}
      <AuthSessionSync />
      {children}
    </AuthContext.Provider>
  );
}
