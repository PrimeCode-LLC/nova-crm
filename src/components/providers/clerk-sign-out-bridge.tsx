"use client";

import * as React from "react";
import { useClerk } from "@clerk/nextjs";

type ClerkSignOutFn = (opts?: { redirectUrl?: string }) => Promise<void>;

/**
 * Registers Clerk's signOut with the parent AuthProvider.
 * Must render under OptionalClerkProvider (ClerkProvider).
 */
export function ClerkSignOutBridge({
  register,
}: {
  register: (fn: ClerkSignOutFn) => void;
}) {
  const { signOut } = useClerk();

  React.useEffect(() => {
    register(async (opts) => {
      await signOut(opts);
    });
  }, [register, signOut]);

  return null;
}
