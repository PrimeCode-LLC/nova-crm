"use client";

import { ClerkProvider as ClerkNextProvider } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/auth/clerk-appearance";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";

/**
 * Wraps children with Clerk only when `auth_clerk_v1` is on and keys exist.
 * Keeps Firebase-only local/staging free of Clerk client bootstrap.
 */
export function OptionalClerkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isClerkAuthV1Enabled()) {
    return children;
  }
  return (
    <ClerkNextProvider appearance={clerkAppearance}>{children}</ClerkNextProvider>
  );
}
