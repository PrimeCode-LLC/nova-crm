import type { Followup } from "@/lib/types";

/** Open (incomplete) followups for a lead that still have a queued outbound email. */
export function openFollowupsWithScheduledEmail(
  followups: readonly Followup[],
  leadId: string,
): Followup[] {
  return followups.filter(
    (f) =>
      f.leadId === leadId &&
      !f.completedAt &&
      Boolean(f.scheduledEmailId?.trim()),
  );
}

/**
 * Cancel a pending scheduledEmails doc (demo store or live API).
 * Caller should clear the followup schedule fields after success.
 */
export async function cancelScheduledEmailClient(input: {
  scheduledEmailId: string;
  isDemo: boolean;
  cancelDemo: (id: string) => void;
}): Promise<{ ok: true } | { error: string }> {
  const id = input.scheduledEmailId.trim();
  if (!id) return { error: "Missing scheduled email id." };

  if (input.isDemo) {
    input.cancelDemo(id);
    return { ok: true };
  }

  try {
    const res = await fetch(`/api/email/scheduled/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) return { error: data.error ?? "Could not cancel scheduled email" };
    return { ok: true };
  } catch {
    return { error: "Could not reach the server" };
  }
}

/** Cancel queued mail for each followup and invoke clearSchedule on success. */
export async function cancelScheduledEmailsForFollowups(input: {
  followups: readonly Followup[];
  isDemo: boolean;
  cancelDemo: (id: string) => void;
  clearSchedule: (followupId: string) => void;
}): Promise<{ cancelled: number; errors: string[] }> {
  let cancelled = 0;
  const errors: string[] = [];

  for (const f of input.followups) {
    const sid = f.scheduledEmailId?.trim();
    if (!sid) continue;
    const result = await cancelScheduledEmailClient({
      scheduledEmailId: sid,
      isDemo: input.isDemo,
      cancelDemo: input.cancelDemo,
    });
    if ("error" in result) {
      errors.push(result.error);
      continue;
    }
    input.clearSchedule(f.id);
    cancelled += 1;
  }

  return { cancelled, errors };
}
