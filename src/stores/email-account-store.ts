import { create } from "zustand";
import {
  type EmailMailboxSettings,
  type MailDraft,
  type MailSent,
  type MailInbound,
  type ScheduledEmail,
  defaultEmailMailboxSettings,
} from "@/lib/email-account-types";
import { buildDemoEmailSeed } from "@/lib/demo-email-seed";
import { mailInboundToSent, mergeSentMailRow } from "@/lib/email/mail-inbound-to-sent";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { normalizeBlockedSenderDomain } from "@/lib/email/blocked-sender-domains";
import {
  type MailLabel,
  createMailLabelId,
  defaultMailLabelColor,
  inboundMessageMetaKey,
} from "@/lib/email/mail-labels";
import {
  type MailFlagId,
  DEFAULT_MAIL_FLAG_ID,
} from "@/lib/email/mail-flags";

export interface EmailAccountStore {
  /** Live workspace: true after /api/email/mailboxes load (or failed); demo: true immediately. */
  emailServerHydrated: boolean;
  /** When true, PATCH mailboxes + meta to API (live workspace only). */
  emailServerSyncEnabled: boolean;
  /**
   * Live workspace: viewing another member's mailbox. Blocks persisting account meta
   * (labels, blocked domains, lead links) to the signed-in user's Firestore doc.
   */
  mailboxDataReadOnly: boolean;
  /** Live workspace: compose, trash, and other IMAP write actions disabled. */
  inboxWriteDisabled: boolean;
  /**
   * Live workspace: Firebase uid of the member whose mailbox list/meta is loaded (`null` = signed-in user).
   * Admins set this to open another active member’s inbox (read-only).
   */
  mailViewAsUid: string | null;
  mailboxes: EmailMailboxSettings[];
  activeMailboxId: string;
  linkedLeadByMessageId: Record<string, string>;
  /** Sender domains whose INBOX messages are auto-moved to Trash. */
  blockedSenderDomains: string[];
  /** Gmail-style user labels for inbox mail. */
  mailLabels: MailLabel[];
  labelsByMessageId: Record<string, string[]>;
  flagByMessageId: Record<string, MailFlagId>;
  inboundByMailbox: Record<string, MailInbound[]>;
  /** Messages shown in Email → Trash (loaded from server Trash folder or demo moves). */
  trashInboundByMailbox: Record<string, MailInbound[]>;
  drafts: MailDraft[];
  sent: MailSent[];
  scheduled: ScheduledEmail[];
  setEmailServerHydrated: (v: boolean) => void;
  setEmailServerSyncEnabled: (v: boolean) => void;
  hydrateFromServer: (payload: {
    mailboxes: EmailMailboxSettings[];
    activeMailboxId: string;
    linkedLeadByMessageId: Record<string, string>;
    blockedSenderDomains?: string[];
    mailLabels?: MailLabel[];
    labelsByMessageId?: Record<string, string[]>;
    flagByMessageId?: Record<string, MailFlagId>;
    mailboxReadOnly?: boolean;
    mailboxAccountReadOnly?: boolean;
  }) => void;
  addBlockedSenderDomain: (domain: string) => void;
  removeBlockedSenderDomain: (domain: string) => void;
  /** Live: switch inbox subject (admin). Clears cached threads until the next mailbox hydrate. */
  setMailViewAsUid: (uid: string | null) => void;
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
  /** Apply offset-0 IMAP Sent list; keeps older loaded pages. */
  reconcileSentHeadFromSync: (mailboxId: string, headRows: MailInbound[]) => void;
  /** Append older Sent rows (dedupe by IMAP `uid`). */
  appendSentServer: (mailboxId: string, messages: MailInbound[]) => void;
  mergeSentBodies: (
    mailboxId: string,
    updates: Array<{ uid: number; bodyText?: string; bodyHtml?: string; preview?: string; bodySynced?: boolean }>,
  ) => void;
  mergeTrashBodies: (
    mailboxId: string,
    updates: Array<{ uid: number } & Partial<MailInbound>>,
  ) => void;
  /** Remove rows from the in-memory INBOX list (after server move-to-trash). Cleans lead links keyed by inbox uid. */
  removeInboundByUids: (mailboxId: string, uids: number[]) => void;
  /** Move messages from local INBOX cache to local Trash cache (demo mode). */
  moveInboundUidsToTrashLocal: (mailboxId: string, uids: number[]) => void;
  /** Move messages from local Trash cache back to INBOX (demo or optimistic UI after restore). */
  moveTrashUidsToInboxLocal: (mailboxId: string, uids: number[]) => void;
  /** Remove from local Trash cache after permanent delete (demo) or optimistic UI. */
  removeTrashByUids: (mailboxId: string, uids: number[]) => void;
  /** Update \\Seen for INBOX rows by IMAP uid (optimistic UI + after IMAP STORE). */
  patchInboundSeen: (mailboxId: string, uids: number[], seen: boolean) => void;
  /** Update \\Seen for Trash rows by IMAP uid. */
  patchTrashSeen: (mailboxId: string, uids: number[], seen: boolean) => void;
  upsertDraft: (draft: Omit<MailDraft, "id" | "updatedAt"> & { id?: string }) => string;
  deleteDraft: (id: string) => void;
  addSent: (item: Omit<MailSent, "id" | "sentAt">) => string;
  addScheduled: (item: Omit<ScheduledEmail, "id" | "createdAt" | "status">) => string;
  cancelScheduled: (id: string) => void;
  setScheduled: (items: ScheduledEmail[]) => void;
  processDueScheduledLocal: () => void;
  linkMessageToLead: (messageId: string, leadId: string) => void;
  unlinkMessageToLead: (messageId: string) => void;
  createMailLabel: (name: string, color?: string) => string;
  renameMailLabel: (labelId: string, name: string) => void;
  deleteMailLabel: (labelId: string) => void;
  addLabelsToMessages: (messageKeys: string[], labelIds: string[]) => void;
  removeLabelFromMessages: (messageKeys: string[], labelId: string) => void;
  toggleMessageLabel: (messageKeys: string[], labelId: string) => void;
  setMessageFlag: (messageKeys: string[], flagId: MailFlagId | null) => void;
  toggleMessageFlag: (messageKeys: string[]) => void;
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
  if (get().mailboxDataReadOnly) return;
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
        blockedSenderDomains: s.blockedSenderDomains,
        mailLabels: s.mailLabels,
        labelsByMessageId: s.labelsByMessageId,
        flagByMessageId: s.flagByMessageId,
      }),
    });
  }, 800);
}

export const useEmailAccountStore = create<EmailAccountStore>()((set, get) => ({
  emailServerHydrated: false,
  emailServerSyncEnabled: false,
  mailboxDataReadOnly: false,
  inboxWriteDisabled: false,
  mailViewAsUid: null,
  mailboxes: [defaultEmailMailboxSettings({ label: "Primary mailbox" })],
  activeMailboxId: "",
  linkedLeadByMessageId: {},
  blockedSenderDomains: [],
  mailLabels: [],
  labelsByMessageId: {},
  flagByMessageId: {},
  inboundByMailbox: {},
  trashInboundByMailbox: {},
  drafts: [],
  sent: [],
  scheduled: [],
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
    const blocked = (payload.blockedSenderDomains ?? [])
      .map(normalizeBlockedSenderDomain)
      .filter(Boolean);
    set({
      mailboxes,
      activeMailboxId: active,
      linkedLeadByMessageId: payload.linkedLeadByMessageId,
      blockedSenderDomains: [...new Set(blocked)],
      mailLabels: payload.mailLabels ?? [],
      labelsByMessageId: payload.labelsByMessageId ?? {},
      flagByMessageId: payload.flagByMessageId ?? {},
      mailboxDataReadOnly: Boolean(payload.mailboxAccountReadOnly ?? payload.mailboxReadOnly),
      inboxWriteDisabled: Boolean(payload.mailboxReadOnly),
    });
  },
  addBlockedSenderDomain: (domain) => {
    if (get().mailboxDataReadOnly) return;
    const key = normalizeBlockedSenderDomain(domain);
    if (!key) return;
    set((s) => {
      if (s.blockedSenderDomains.includes(key)) return s;
      return { blockedSenderDomains: [...s.blockedSenderDomains, key] };
    });
    scheduleEmailMetaPersist(get);
  },
  removeBlockedSenderDomain: (domain) => {
    if (get().mailboxDataReadOnly) return;
    const key = normalizeBlockedSenderDomain(domain);
    if (!key) return;
    set((s) => ({
      blockedSenderDomains: s.blockedSenderDomains.filter((d) => d !== key),
    }));
    scheduleEmailMetaPersist(get);
  },
  setMailViewAsUid: (uid) =>
    set((s) => {
      const next = !uid?.trim() ? null : uid.trim();
      if (next === s.mailViewAsUid) return s;
      return {
        mailViewAsUid: next,
        mailboxDataReadOnly: next != null,
        inboxWriteDisabled: next != null,
        emailServerHydrated: false,
        inboundByMailbox: {},
        trashInboundByMailbox: {},
        drafts: [],
        sent: [],
        linkedLeadByMessageId: {},
        blockedSenderDomains: [],
        mailLabels: [],
        labelsByMessageId: {},
        flagByMessageId: {},
        mailboxes: [defaultEmailMailboxSettings({ label: "Primary mailbox" })],
        activeMailboxId: "",
      };
    }),
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
              assignedUserIds: patch.assignedUserIds ?? mb.assignedUserIds,
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
  reconcileSentHeadFromSync: (mailboxId, headRows) =>
    set((s) => {
      const prevForBox = s.sent.filter((m) => m.mailboxId === mailboxId);
      const localOnly = prevForBox.filter((m) => m.uid == null);
      const otherMailboxes = s.sent.filter((m) => m.mailboxId !== mailboxId);

      if (headRows.length === 0) {
        const kept = [...localOnly].sort(
          (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
        );
        return { sent: [...otherMailboxes, ...kept] };
      }

      const minHeadUid = Math.min(...headRows.map((m) => m.uid));
      const prevByUid = new Map(
        prevForBox.filter((m) => m.uid != null).map((m) => [m.uid!, m]),
      );
      const mergedHead = headRows.map((row) => {
        const server = mailInboundToSent(mailboxId, row);
        return mergeSentMailRow(prevByUid.get(server.uid!), server);
      });
      const tail = prevForBox.filter((m) => m.uid != null && m.uid! < minHeadUid);
      const combined = [...mergedHead, ...tail].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      );
      return { sent: [...otherMailboxes, ...combined] };
    }),
  appendSentServer: (mailboxId, messages) =>
    set((s) => {
      if (messages.length === 0) return s;
      const otherMailboxes = s.sent.filter((m) => m.mailboxId !== mailboxId);
      const prevForBox = s.sent.filter((m) => m.mailboxId === mailboxId && m.uid != null);
      const byUid = new Map(prevForBox.map((m) => [m.uid!, m]));
      for (const row of messages) {
        const server = mailInboundToSent(mailboxId, row);
        byUid.set(server.uid!, mergeSentMailRow(byUid.get(server.uid!), server));
      }
      const combined = [...byUid.values()].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      );
      return { sent: [...otherMailboxes, ...combined] };
    }),
  mergeSentBodies: (mailboxId, updates) =>
    set((s) => {
      if (updates.length === 0) return s;
      const patch = new Map(updates.map((u) => [u.uid, u]));
      const next = s.sent.map((m) => {
        if (m.mailboxId !== mailboxId || m.uid == null) return m;
        const p = patch.get(m.uid);
        if (!p) return m;
        const body = p.bodyText ?? m.body;
        return {
          ...m,
          body,
          bodyHtml: p.bodyHtml ?? m.bodyHtml,
          preview: p.preview ?? m.preview,
          bodySynced: p.bodySynced ?? true,
        };
      });
      return { sent: next };
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
      const nextLabels = { ...s.labelsByMessageId };
      const nextFlags = { ...s.flagByMessageId };
      for (const m of prev) {
        if (!uidSet.has(m.uid)) continue;
        const key = inboundMessageMetaKey(mailboxId, m);
        delete nextLinks[key];
        delete nextLabels[key];
        delete nextFlags[key];
      }
      return {
        inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: nextInbound },
        linkedLeadByMessageId: nextLinks,
        labelsByMessageId: nextLabels,
        flagByMessageId: nextFlags,
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
  moveTrashUidsToInboxLocal: (mailboxId, uids) => {
    if (uids.length === 0) return;
    const uidSet = new Set(uids);
    set((s) => {
      const trashPrev = s.trashInboundByMailbox[mailboxId] ?? [];
      const moving = trashPrev.filter((m) => uidSet.has(m.uid));
      const nextTrash = trashPrev.filter((m) => !uidSet.has(m.uid));
      const inboundPrev = s.inboundByMailbox[mailboxId] ?? [];
      return {
        trashInboundByMailbox: { ...s.trashInboundByMailbox, [mailboxId]: nextTrash },
        inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: [...moving, ...inboundPrev] },
      };
    });
    scheduleEmailMetaPersist(get);
  },
  patchInboundSeen: (mailboxId, uids, seen) => {
    if (uids.length === 0) return;
    const uidSet = new Set(uids);
    set((s) => {
      const prev = s.inboundByMailbox[mailboxId] ?? [];
      if (prev.length === 0) return s;
      const next = prev.map((m) => (uidSet.has(m.uid) ? { ...m, seen } : m));
      return { inboundByMailbox: { ...s.inboundByMailbox, [mailboxId]: next } };
    });
  },
  patchTrashSeen: (mailboxId, uids, seen) => {
    if (uids.length === 0) return;
    const uidSet = new Set(uids);
    set((s) => {
      const prev = s.trashInboundByMailbox[mailboxId] ?? [];
      if (prev.length === 0) return s;
      const next = prev.map((m) => (uidSet.has(m.uid) ? { ...m, seen } : m));
      return { trashInboundByMailbox: { ...s.trashInboundByMailbox, [mailboxId]: next } };
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
  addScheduled: (item) => {
    const id = `sch-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const row: ScheduledEmail = { ...item, id, createdAt, status: "pending" };
    set({ scheduled: [row, ...get().scheduled] });
    return id;
  },
  cancelScheduled: (id) => {
    set({
      scheduled: get().scheduled.map((s) =>
        s.id === id && s.status === "pending" ? { ...s, status: "cancelled" as const } : s,
      ),
    });
  },
  setScheduled: (items) => set({ scheduled: items }),
  processDueScheduledLocal: () => {
    const now = Date.now();
    const scheduled = get().scheduled;
    let changed = false;
    const next = scheduled.map((s) => {
      if (s.status !== "pending") return s;
      const due = new Date(s.scheduledAt).getTime();
      if (Number.isNaN(due) || due > now) return s;
      changed = true;
      const sentAt = new Date().toISOString();
      get().addSent({
        mailboxId: s.mailboxId,
        from: s.from,
        to: s.to,
        subject: s.subject,
        body: s.body,
      });
      return { ...s, status: "sent" as const, sentAt };
    });
    if (changed) set({ scheduled: next });
  },
  linkMessageToLead: (messageId, leadId) => {
    if (get().mailboxDataReadOnly) return;
    set((s) => ({
      linkedLeadByMessageId: { ...s.linkedLeadByMessageId, [messageId]: leadId },
    }));
    scheduleEmailMetaPersist(get);
  },
  unlinkMessageToLead: (messageId) => {
    if (get().mailboxDataReadOnly) return;
    set((s) => {
      const next = { ...s.linkedLeadByMessageId };
      delete next[messageId];
      return { linkedLeadByMessageId: next };
    });
    scheduleEmailMetaPersist(get);
  },
  createMailLabel: (name, color) => {
    if (get().mailboxDataReadOnly) return "";
    const trimmed = name.trim();
    if (!trimmed) return "";
    const id = createMailLabelId();
    set((s) => ({
      mailLabels: [
        ...s.mailLabels,
        { id, name: trimmed, color: color ?? defaultMailLabelColor(s.mailLabels.length) },
      ],
    }));
    scheduleEmailMetaPersist(get);
    return id;
  },
  renameMailLabel: (labelId, name) => {
    if (get().mailboxDataReadOnly) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) => ({
      mailLabels: s.mailLabels.map((l) => (l.id === labelId ? { ...l, name: trimmed } : l)),
    }));
    scheduleEmailMetaPersist(get);
  },
  deleteMailLabel: (labelId) => {
    if (get().mailboxDataReadOnly) return;
    set((s) => {
      const nextLabels = { ...s.labelsByMessageId };
      for (const [key, ids] of Object.entries(nextLabels)) {
        const filtered = ids.filter((id) => id !== labelId);
        if (filtered.length === 0) delete nextLabels[key];
        else nextLabels[key] = filtered;
      }
      return {
        mailLabels: s.mailLabels.filter((l) => l.id !== labelId),
        labelsByMessageId: nextLabels,
      };
    });
    scheduleEmailMetaPersist(get);
  },
  addLabelsToMessages: (messageKeys, labelIds) => {
    if (get().mailboxDataReadOnly || messageKeys.length === 0 || labelIds.length === 0) return;
    set((s) => {
      const next = { ...s.labelsByMessageId };
      for (const key of messageKeys) {
        const prev = new Set(next[key] ?? []);
        for (const id of labelIds) prev.add(id);
        next[key] = [...prev];
      }
      return { labelsByMessageId: next };
    });
    scheduleEmailMetaPersist(get);
  },
  removeLabelFromMessages: (messageKeys, labelId) => {
    if (get().mailboxDataReadOnly || messageKeys.length === 0) return;
    set((s) => {
      const next = { ...s.labelsByMessageId };
      for (const key of messageKeys) {
        const prev = next[key];
        if (!prev) continue;
        const filtered = prev.filter((id) => id !== labelId);
        if (filtered.length === 0) delete next[key];
        else next[key] = filtered;
      }
      return { labelsByMessageId: next };
    });
    scheduleEmailMetaPersist(get);
  },
  toggleMessageLabel: (messageKeys, labelId) => {
    if (get().mailboxDataReadOnly || messageKeys.length === 0) return;
    const s = get();
    const hasAny = messageKeys.some((key) => s.labelsByMessageId[key]?.includes(labelId));
    if (hasAny) get().removeLabelFromMessages(messageKeys, labelId);
    else get().addLabelsToMessages(messageKeys, [labelId]);
  },
  setMessageFlag: (messageKeys, flagId) => {
    if (get().mailboxDataReadOnly || messageKeys.length === 0) return;
    set((s) => {
      const next = { ...s.flagByMessageId };
      for (const key of messageKeys) {
        if (flagId == null) delete next[key];
        else next[key] = flagId;
      }
      return { flagByMessageId: next };
    });
    scheduleEmailMetaPersist(get);
  },
  toggleMessageFlag: (messageKeys) => {
    if (get().mailboxDataReadOnly || messageKeys.length === 0) return;
    const s = get();
    const hasAny = messageKeys.some((key) => s.flagByMessageId[key] != null);
    if (hasAny) get().setMessageFlag(messageKeys, null);
    else get().setMessageFlag(messageKeys, DEFAULT_MAIL_FLAG_ID);
  },
  clearLocalMail: () => set({ drafts: [], sent: [], scheduled: [], inboundByMailbox: {}, trashInboundByMailbox: {} }),
  resetForDemoMode: () => {
    const seed = buildDemoEmailSeed();
    set({
      mailboxes: seed.mailboxes,
      activeMailboxId: seed.activeMailboxId,
      linkedLeadByMessageId: seed.linkedLeadByMessageId,
      blockedSenderDomains: [],
      mailLabels: seed.mailLabels,
      labelsByMessageId: seed.labelsByMessageId,
      flagByMessageId: seed.flagByMessageId,
      inboundByMailbox: seed.inboundByMailbox,
      trashInboundByMailbox: {},
      drafts: seed.drafts,
      sent: seed.sent,
      scheduled: [],
      mailViewAsUid: null,
      mailboxDataReadOnly: false,
      inboxWriteDisabled: false,
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
