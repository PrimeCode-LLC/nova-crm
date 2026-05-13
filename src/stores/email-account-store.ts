import { create } from "zustand";
import {
  type EmailMailboxSettings,
  type MailDraft,
  type MailSent,
  type MailInbound,
  defaultEmailMailboxSettings,
} from "@/lib/email-account-types";
import { buildDemoEmailSeed } from "@/lib/demo-email-seed";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";

export interface EmailAccountStore {
  /** Live workspace: true after /api/email/mailboxes load (or failed); demo: true immediately. */
  emailServerHydrated: boolean;
  /** When true, PATCH mailboxes + meta to API (live workspace only). */
  emailServerSyncEnabled: boolean;
  mailboxes: EmailMailboxSettings[];
  activeMailboxId: string;
  linkedLeadByMessageId: Record<string, string>;
  inboundByMailbox: Record<string, MailInbound[]>;
  /** Messages shown in Email → Trash (loaded from server Trash folder or demo moves). */
  trashInboundByMailbox: Record<string, MailInbound[]>;
  drafts: MailDraft[];
  sent: MailSent[];
  setEmailServerHydrated: (v: boolean) => void;
  setEmailServerSyncEnabled: (v: boolean) => void;
  hydrateFromServer: (payload: {
    mailboxes: EmailMailboxSettings[];
    activeMailboxId: string;
    linkedLeadByMessageId: Record<string, string>;
  }) => void;
  setActiveMailbox: (mailboxId: string) => void;
  addMailbox: () => string;
  removeMailbox: (mailboxId: string) => void;
  updateMailbox: (mailboxId: string, patch: Partial<EmailMailboxSettings>) => void;
  setSmtp: (mailboxId: string, patch: Partial<EmailMailboxSettings["smtp"]>) => void;
  setImap: (mailboxId: string, patch: Partial<EmailMailboxSettings["imap"]>) => void;
  setInbound: (mailboxId: string, messages: MailInbound[]) => void;
  /** Append older INBOX rows (dedupe by IMAP `uid`). */
  appendInbound: (mailboxId: string, messages: MailInbound[]) => void;
  /** Merge parsed body / headers into existing rows by IMAP `uid`. */
  mergeInboundBodies: (
    mailboxId: string,
    updates: Array<{ uid: number } & Partial<MailInbound>>,
  ) => void;
  setTrashInbound: (mailboxId: string, messages: MailInbound[]) => void;
  /**
   * Apply offset-0 IMAP list: upsert newest page, keep older “Load more” rows (UID below this page’s minimum).
   */
  reconcileInboundHeadFromSync: (mailboxId: string, headRows: MailInbound[]) => void;
  reconcileTrashHeadFromSync: (mailboxId: string, headRows: MailInbound[]) => void;
  mergeTrashBodies: (
    mailboxId: string,
    updates: Array<{ uid: number } & Partial<MailInbound>>,
  ) => void;
  /** Remove rows from the in-memory INBOX list (after server move-to-trash). Cleans lead links keyed by inbox uid. */
  removeInboundByUids: (mailboxId: string, uids: number[]) => void;
  /** Move messages from local INBOX cache to local Trash cache (demo mode). */
  moveInboundUidsToTrashLocal: (mailboxId: string, uids: number[]) => void;
  /** Remove from local Trash cache after permanent delete (demo) or optimistic UI. */
  removeTrashByUids: (mailboxId: string, uids: number[]) => void;
  upsertDraft: (draft: Omit<MailDraft, "id" | "updatedAt"> & { id?: string }) => string;
  deleteDraft: (id: string) => void;
  addSent: (item: Omit<MailSent, "id" | "sentAt">) => string;
  linkMessageToLead: (messageId: string, leadId: string) => void;
  unlinkMessageToLead: (messageId: string) => void;
  clearLocalMail: () => void;
  /** Demo workspace: discard server-backed mailboxes and use a fresh local template. */
  resetForDemoMode: () => void;
}

let metaPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** Merge server list row with cached row so a header-only refresh does not wipe fetched bodies. */
function mergeMailInboundRow(prev: MailInbound | undefined, server: MailInbound): MailInbound {
  if (!prev) return server;
  if (prev.bodySynced && server.bodySynced === false) {
    return {
      ...server,
      bodyText: prev.bodyText,
      bodyHtml: prev.bodyHtml,
      bodySynced: true,
      preview: prev.preview || server.preview,
      cc: prev.cc ?? server.cc,
      attachments: prev.attachments ?? server.attachments,
    };
  }
  return {
    ...prev,
    ...server,
    cc: server.cc ?? prev.cc,
    attachments: server.attachments ?? prev.attachments,
  };
}

function scheduleEmailMetaPersist(get: () => EmailAccountStore) {
  if (typeof window === "undefined") return;
  if (!get().emailServerSyncEnabled) return;
  if (metaPersistTimer) clearTimeout(metaPersistTimer);
  metaPersistTimer = setTimeout(() => {
    metaPersistTimer = null;
    const s = get();
    void fetch("/api/email/mailboxes/meta", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        activeMailboxId: s.activeMailboxId,
        linkedLeadByMessageId: s.linkedLeadByMessageId,
      }),
    });
  }, 800);
}

export const useEmailAccountStore = create<EmailAccountStore>()((set, get) => ({
  emailServerHydrated: false,
  emailServerSyncEnabled: false,
  mailboxes: [defaultEmailMailboxSettings({ label: "Primary mailbox" })],
  activeMailboxId: "",
  linkedLeadByMessageId: {},
  inboundByMailbox: {},
  trashInboundByMailbox: {},
  drafts: [],
  sent: [],
  setEmailServerHydrated: (v) => set({ emailServerHydrated: v }),
  setEmailServerSyncEnabled: (v) => set({ emailServerSyncEnabled: v }),
  hydrateFromServer: (payload) => {
    const mailboxes =
      payload.mailboxes.length > 0
        ? payload.mailboxes
        : [defaultEmailMailboxSettings({ label: "Primary mailbox" })];
    const activeFromServer = payload.activeMailboxId.trim();
    const active =
      activeFromServer && mailboxes.some((m) => m.id === activeFromServer)
        ? activeFromServer
        : mailboxes[0].id;
    set({
      mailboxes,
      activeMailboxId: active,
      linkedLeadByMessageId: payload.linkedLeadByMessageId,
    });
  },
  setActiveMailbox: (mailboxId) => {
    set({ activeMailboxId: mailboxId });
    scheduleEmailMetaPersist(get);
  },
  addMailbox: () => {
    const next = defaultEmailMailboxSettings({
      label: `Mailbox ${get().mailboxes.length + 1}`,
    });
    set((s) => ({ mailboxes: [...s.mailboxes, next], activeMailboxId: next.id }));
    scheduleEmailMetaPersist(get);
    return next.id;
  },
  removeMailbox: (mailboxId) => {
    if (typeof window !== "undefined" && get().emailServerSyncEnabled) {
      void fetch(`/api/email/mailboxes?mailboxId=${encodeURIComponent(mailboxId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
    }
    set((s) => {
      const rest = s.mailboxes.filter((mb) => mb.id !== mailboxId);
      if (rest.length === 0) {
        const fallback = defaultEmailMailboxSettings({ label: "Primary mailbox" });
        return {
          ...s,
          mailboxes: [fallback],
          activeMailboxId: fallback.id,
          inboundByMailbox: {},
          trashInboundByMailbox: {},
          drafts: s.drafts.filter((d) => d.mailboxId !== mailboxId),
          sent: s.sent.filter((m) => m.mailboxId !== mailboxId),
        };
      }
      return {
        ...s,
        mailboxes: rest,
        activeMailboxId:
          s.activeMailboxId === mailboxId ? (rest[0]?.id ?? "") : s.activeMailboxId,
        inboundByMailbox: Object.fromEntries(
          Object.entries(s.inboundByMailbox).filter(([id]) => id !== mailboxId),
        ),
        trashInboundByMailbox: Object.fromEntries(
          Object.entries(s.trashInboundByMailbox).filter(([id]) => id !== mailboxId),
        ),
        drafts: s.drafts.filter((d) => d.mailboxId !== mailboxId),
        sent: s.sent.filter((m) => m.mailboxId !== mailboxId),
      };
    });
    scheduleEmailMetaPersist(get);
  },
  updateMailbox: (mailboxId, patch) =>
    set((s) => ({
      mailboxes: s.mailboxes.map((mb) =>
        mb.id === mailboxId
          ? {
              ...mb,
              ...patch,
              smtp: { ...mb.smtp, ...(patch.smtp ?? {}) },
              imap: { ...mb.imap, ...(patch.imap ?? {}) },
            }
          : mb,
      ),
    })),
  setSmtp: (mailboxId, patch) =>
    set((s) => ({
      mailboxes: s.mailboxes.map((mb) =>
        mb.id === mailboxId ? { ...mb, smtp: { ...mb.smtp, ...patch } } : mb,
      ),
    })),
  setImap: (mailboxId, patch) =>
    set((s) => ({
      mailboxes: s.mailboxes.map((mb) =>
        mb.id === mailboxId ? { ...mb, imap: { ...mb.imap, ...patch } } : mb,
      ),
    })),
  setInbound: (mailboxId, messages) =>
    set((s) => ({ inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: messages } })),
  appendInbound: (mailboxId, messages) =>
    set((s) => {
      if (messages.length === 0) return s;
      const prev = s.inboundByMailbox[mailboxId] ?? [];
      const byUid = new Map<number, MailInbound>();
      for (const m of prev) byUid.set(m.uid, m);
      for (const m of messages) {
        if (!byUid.has(m.uid)) byUid.set(m.uid, m);
      }
      return { inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: Array.from(byUid.values()) } };
    }),
  mergeInboundBodies: (mailboxId, updates) =>
    set((s) => {
      const prev = s.inboundByMailbox[mailboxId] ?? [];
      if (prev.length === 0 || updates.length === 0) return s;
      const patch = new Map(updates.map((u) => [u.uid, u]));
      const next = prev.map((m) => {
        const p = patch.get(m.uid);
        if (!p) return m;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip uid before merge
        const { uid, ...rest } = p;
        return { ...m, ...rest };
      });
      return { inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: next } };
    }),
  setTrashInbound: (mailboxId, messages) =>
    set((s) => ({ trashInboundByMailbox: { ...s.trashInboundByMailbox, [mailboxId]: messages } })),
  reconcileInboundHeadFromSync: (mailboxId, headRows) =>
    set((s) => {
      if (headRows.length === 0) {
        return { inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: [] } };
      }
      const minHeadUid = Math.min(...headRows.map((m) => m.uid));
      const prev = s.inboundByMailbox[mailboxId] ?? [];
      const prevByUid = new Map(prev.map((m) => [m.uid, m]));
      const mergedHead = headRows.map((server) => mergeMailInboundRow(prevByUid.get(server.uid), server));
      const tailByUid = new Map<number, MailInbound>();
      for (const m of prev) {
        if (m.uid < minHeadUid) tailByUid.set(m.uid, m);
      }
      const tailSorted = [...tailByUid.values()].sort((a, b) => b.uid - a.uid);
      return {
        inboundByMailbox: {
          ...s.inboundByMailbox,
          [mailboxId]: [...mergedHead, ...tailSorted],
        },
      };
    }),
  reconcileTrashHeadFromSync: (mailboxId, headRows) =>
    set((s) => {
      if (headRows.length === 0) {
        return { trashInboundByMailbox: { ...s.trashInboundByMailbox, [mailboxId]: [] } };
      }
      const minHeadUid = Math.min(...headRows.map((m) => m.uid));
      const prev = s.trashInboundByMailbox[mailboxId] ?? [];
      const prevByUid = new Map(prev.map((m) => [m.uid, m]));
      const mergedHead = headRows.map((server) => mergeMailInboundRow(prevByUid.get(server.uid), server));
      const tailByUid = new Map<number, MailInbound>();
      for (const m of prev) {
        if (m.uid < minHeadUid) tailByUid.set(m.uid, m);
      }
      const tailSorted = [...tailByUid.values()].sort((a, b) => b.uid - a.uid);
      return {
        trashInboundByMailbox: {
          ...s.trashInboundByMailbox,
          [mailboxId]: [...mergedHead, ...tailSorted],
        },
      };
    }),
  mergeTrashBodies: (mailboxId, updates) =>
    set((s) => {
      const prev = s.trashInboundByMailbox[mailboxId] ?? [];
      if (prev.length === 0 || updates.length === 0) return s;
      const patch = new Map(updates.map((u) => [u.uid, u]));
      const next = prev.map((m) => {
        const p = patch.get(m.uid);
        if (!p) return m;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip uid before merge
        const { uid, ...rest } = p;
        return { ...m, ...rest };
      });
      return { trashInboundByMailbox: { ...s.trashInboundByMailbox, [mailboxId]: next } };
    }),
  removeInboundByUids: (mailboxId, uids) => {
    if (uids.length === 0) return;
    const uidSet = new Set(uids);
    set((s) => {
      const prev = s.inboundByMailbox[mailboxId] ?? [];
      const nextInbound = prev.filter((m) => !uidSet.has(m.uid));
      const nextLinks = { ...s.linkedLeadByMessageId };
      for (const uid of uids) {
        delete nextLinks[`${mailboxId}:in:uid-${uid}`];
      }
      return {
        inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: nextInbound },
        linkedLeadByMessageId: nextLinks,
      };
    });
    scheduleEmailMetaPersist(get);
  },
  moveInboundUidsToTrashLocal: (mailboxId, uids) => {
    if (uids.length === 0) return;
    const uidSet = new Set(uids);
    set((s) => {
      const prev = s.inboundByMailbox[mailboxId] ?? [];
      const moving = prev.filter((m) => uidSet.has(m.uid));
      const nextInbound = prev.filter((m) => !uidSet.has(m.uid));
      const trashPrev = s.trashInboundByMailbox[mailboxId] ?? [];
      return {
        inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: nextInbound },
        trashInboundByMailbox: {
          ...s.trashInboundByMailbox,
          [mailboxId]: [...moving, ...trashPrev],
        },
      };
    });
  },
  removeTrashByUids: (mailboxId, uids) => {
    if (uids.length === 0) return;
    const uidSet = new Set(uids);
    set((s) => {
      const prev = s.trashInboundByMailbox[mailboxId] ?? [];
      return {
        trashInboundByMailbox: {
          ...s.trashInboundByMailbox,
          [mailboxId]: prev.filter((m) => !uidSet.has(m.uid)),
        },
      };
    });
  },
  upsertDraft: ({ id, mailboxId, to, cc, subject, body }) => {
    const draftId = id ?? `d-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const prev = get().drafts;
    const idx = prev.findIndex((d) => d.id === draftId);
    const ccTrim = cc?.trim();
    const row: MailDraft = {
      id: draftId,
      mailboxId,
      to,
      ...(ccTrim ? { cc: ccTrim } : {}),
      subject,
      body,
      updatedAt: now,
    };
    if (idx === -1) set({ drafts: [row, ...prev] });
    else {
      const next = [...prev];
      next[idx] = row;
      set({ drafts: next });
    }
    return draftId;
  },
  deleteDraft: (id) => set({ drafts: get().drafts.filter((d) => d.id !== id) }),
  addSent: (item) => {
    const id = `s-${crypto.randomUUID()}`;
    const sentAt = new Date().toISOString();
    set({ sent: [{ ...item, id, sentAt }, ...get().sent] });
    return id;
  },
  linkMessageToLead: (messageId, leadId) => {
    set((s) => ({
      linkedLeadByMessageId: { ...s.linkedLeadByMessageId, [messageId]: leadId },
    }));
    scheduleEmailMetaPersist(get);
  },
  unlinkMessageToLead: (messageId) => {
    set((s) => {
      const next = { ...s.linkedLeadByMessageId };
      delete next[messageId];
      return { linkedLeadByMessageId: next };
    });
    scheduleEmailMetaPersist(get);
  },
  clearLocalMail: () => set({ drafts: [], sent: [], inboundByMailbox: {}, trashInboundByMailbox: {} }),
  resetForDemoMode: () => {
    const seed = buildDemoEmailSeed();
    set({
      mailboxes: seed.mailboxes,
      activeMailboxId: seed.activeMailboxId,
      linkedLeadByMessageId: seed.linkedLeadByMessageId,
      inboundByMailbox: seed.inboundByMailbox,
      trashInboundByMailbox: {},
      drafts: seed.drafts,
      sent: seed.sent,
    });
  },
}));

export function isEmailAccountConfigured(account: EmailMailboxSettings): boolean {
  return (
    account.enabled &&
    !!account.emailAddress.trim() &&
    !!normalizeMailHost(account.smtp.host)
  );
}

/**
 * True when an IMAP server host is set. Inbox fetch uses vault credentials server-side when `mailboxId`
 * is sent, so this intentionally does not require the "Enable mail" toggle or a filled username in the client.
 */
export function isImapInboxConfigured(account: EmailMailboxSettings): boolean {
  return !!normalizeMailHost(account.imap.host);
}

export function getActiveMailbox(state: Pick<EmailAccountStore, "mailboxes" | "activeMailboxId">) {
  if (state.mailboxes.length === 0) return defaultEmailMailboxSettings({ label: "Primary mailbox" });
  return (
    state.mailboxes.find((mb) => mb.id === state.activeMailboxId) ?? state.mailboxes[0]
  );
}
