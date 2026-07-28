/**
 * Per-user browser prefs for the last mailbox used when scheduling / composing email.
 * Speeds up workflows where someone switches off a full inbox onto a second mailbox.
 */

export type LastUsedMailboxPrefs = {
  /** Last mailbox id chosen in schedule/compose "From". */
  lastMailboxId?: string;
  /** Last multi-select pool used in bulk schedule (newest workflow). */
  lastMailboxPoolIds?: string[];
};

export function lastUsedMailboxPrefsKey(
  organizationId: string,
  userId: string,
): string {
  return `email-schedule-mailbox-prefs:${organizationId}:${userId}`;
}

export function loadLastUsedMailboxPrefs(
  organizationId: string | undefined,
  userId: string | undefined,
): LastUsedMailboxPrefs {
  if (typeof window === "undefined" || !organizationId || !userId) {
    return {};
  }
  try {
    const raw = localStorage.getItem(lastUsedMailboxPrefsKey(organizationId, userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const o = parsed as Record<string, unknown>;
    const lastMailboxId =
      typeof o.lastMailboxId === "string" && o.lastMailboxId.trim()
        ? o.lastMailboxId.trim()
        : undefined;
    const lastMailboxPoolIds = Array.isArray(o.lastMailboxPoolIds)
      ? o.lastMailboxPoolIds
          .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
          .map((id) => id.trim())
      : undefined;
    return {
      lastMailboxId,
      lastMailboxPoolIds:
        lastMailboxPoolIds && lastMailboxPoolIds.length > 0 ? lastMailboxPoolIds : undefined,
    };
  } catch {
    return {};
  }
}

function persist(
  organizationId: string,
  userId: string,
  next: LastUsedMailboxPrefs,
): void {
  try {
    localStorage.setItem(
      lastUsedMailboxPrefsKey(organizationId, userId),
      JSON.stringify(next),
    );
  } catch {
    /* ignore quota */
  }
}

/** Remember the mailbox used for a single / sequence schedule or compose. */
export function rememberLastUsedMailbox(
  organizationId: string | undefined,
  userId: string | undefined,
  mailboxId: string,
): void {
  const id = mailboxId.trim();
  if (typeof window === "undefined" || !organizationId || !userId || !id) return;
  const prev = loadLastUsedMailboxPrefs(organizationId, userId);
  persist(organizationId, userId, { ...prev, lastMailboxId: id });
}

/** Remember the mailbox pool used for bulk sequence scheduling. */
export function rememberLastUsedMailboxPool(
  organizationId: string | undefined,
  userId: string | undefined,
  mailboxIds: string[],
): void {
  if (typeof window === "undefined" || !organizationId || !userId) return;
  const ids = [
    ...new Set(
      mailboxIds.map((id) => id.trim()).filter(Boolean),
    ),
  ];
  if (ids.length === 0) return;
  const prev = loadLastUsedMailboxPrefs(organizationId, userId);
  persist(organizationId, userId, {
    ...prev,
    lastMailboxId: ids[0],
    lastMailboxPoolIds: ids,
  });
}

/**
 * Default "From" mailbox for schedule/compose:
 * last used → concrete active inbox → first available.
 */
export function resolveDefaultScheduleMailboxId(opts: {
  mailboxIds: string[];
  lastUsedId?: string | null;
  activeMailboxId?: string | null;
}): string {
  const ids = opts.mailboxIds.filter(Boolean);
  if (ids.length === 0) return "";
  const last = opts.lastUsedId?.trim();
  if (last && ids.includes(last)) return last;
  const active = opts.activeMailboxId?.trim();
  if (active && ids.includes(active)) return active;
  return ids[0] ?? "";
}

/**
 * Default multi-select pool for bulk schedule:
 * last bulk pool (intersected with available) → else all available.
 * Single-dialog last-used is ignored here so bulk still load-balances across inboxes
 * until the user explicitly narrows the pool once.
 */
export function resolveDefaultScheduleMailboxPool(opts: {
  mailboxIds: string[];
  lastPoolIds?: string[] | null;
}): string[] {
  const available = opts.mailboxIds.filter(Boolean);
  if (available.length === 0) return [];

  const pool = (opts.lastPoolIds ?? [])
    .map((id) => id.trim())
    .filter((id) => available.includes(id));
  if (pool.length > 0) return pool;

  return available;
}
