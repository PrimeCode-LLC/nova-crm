"use client";

/** Exchanges a Firebase ID token for an httpOnly session cookie (server verifies with Admin). */
export async function exchangeIdTokenForSession(
  idToken: string,
  options?: { company?: string },
): Promise<void> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, company: options?.company }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Session failed (${res.status})`);
  }
}
