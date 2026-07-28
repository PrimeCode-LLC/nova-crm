import type { Followup } from "@/lib/types";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";

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

export type CancelScheduledEmailClientInput = {
  scheduledEmailId: string;
  isDemo: boolean;
  cancelDemo: (id: string) => void;
  reason?: string;
  /** Linked followup — lets the server unlink orphans and try the owner mailbox. */
  followupId?: string;
  /** Authenticated viewer uid (for `forUser` resolution). */
  selfUid?: string;
  mailViewAsUid?: string | null;
  activeMailboxDataOwnerUid?: string | null;
};

/**
 * Cancel a pending scheduledEmails doc (demo store or live API).
 * Missing / already-finished queue docs succeed so followup schedule links can be cleared.
 * Caller should clear the followup schedule fields after success.
 */
export async function cancelScheduledEmailClient(
  input: CancelScheduledEmailClientInput,
): Promise<{ ok: true } | { error: string }> {
  const id = input.scheduledEmailId.trim();
  if (!id) return { error: "Missing scheduled email id." };

  if (input.isDemo) {
    input.cancelDemo(id);
    return { ok: true };
  }

  try {
    const params = new URLSearchParams();
    const reason = input.reason?.trim();
    if (reason) params.set("reason", reason);
    const followupId = input.followupId?.trim();
    if (followupId) params.set("followupId", followupId);

    let path = `/api/email/scheduled/${encodeURIComponent(id)}`;
    const qs = params.toString();
    if (qs) path = `${path}?${qs}`;

    const selfUid = (input.selfUid ?? "").trim();
    if (selfUid) {
      const forUid = resolveMailApiForUserUid({
        mailViewAsUid: input.mailViewAsUid,
        activeMailboxDataOwnerUid: input.activeMailboxDataOwnerUid,
        selfUid,
      });
      path = appendMailDataOwnerParam(path, forUid, selfUid);
    }

    const res = await fetch(path, { method: "DELETE" });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      const err = data.error ?? "Could not cancel scheduled email";
      // Legacy servers / race: treat missing queue doc as already cancelled.
      if (/not found/i.test(err)) return { ok: true };
      return { error: err };
    }
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
  reason?: string;
  selfUid?: string;
  mailViewAsUid?: string | null;
  activeMailboxDataOwnerUid?: string | null;
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
      reason: input.reason,
      followupId: f.id,
      selfUid: input.selfUid,
      mailViewAsUid: input.mailViewAsUid,
      activeMailboxDataOwnerUid: input.activeMailboxDataOwnerUid,
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
