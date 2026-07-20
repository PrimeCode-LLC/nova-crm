/** Retry a failed / needs_retry scheduled email via the live API. */
export async function retryScheduledEmailClient(input: {
  scheduledEmailId: string;
  isDemo: boolean;
  /** Demo: bump scheduledAt and clear error on the store row. */
  retryDemo?: (id: string) => void;
}): Promise<{ ok: true; scheduledAt?: string } | { error: string }> {
  const id = input.scheduledEmailId.trim();
  if (!id) return { error: "Missing scheduled email id." };

  if (input.isDemo) {
    input.retryDemo?.(id);
    return { ok: true, scheduledAt: new Date(Date.now() + 60_000).toISOString() };
  }

  try {
    const res = await fetch(`/api/email/scheduled/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "retry" }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; scheduledAt?: string };
    if (!data.ok) return { error: data.error ?? "Could not retry scheduled email" };
    return { ok: true, scheduledAt: data.scheduledAt };
  } catch {
    return { error: "Could not reach the server" };
  }
}
