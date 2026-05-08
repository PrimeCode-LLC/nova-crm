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
  upsertDraft: ({ id, mailboxId, to, subject, body }) => {
    const draftId = id ?? `d-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const prev = get().drafts;
    const idx = prev.findIndex((d) => d.id === draftId);
    const row: MailDraft = { id: draftId, mailboxId, to, subject, body, updatedAt: now };
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
  clearLocalMail: () => set({ drafts: [], sent: [], inboundByMailbox: {} }),
  resetForDemoMode: () => {
    const seed = buildDemoEmailSeed();
    set({
      mailboxes: seed.mailboxes,
      activeMailboxId: seed.activeMailboxId,
      linkedLeadByMessageId: seed.linkedLeadByMessageId,
      inboundByMailbox: seed.inboundByMailbox,
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

/** Enough IMAP settings to load the mailbox (password sent only when fetching). */
export function isImapInboxConfigured(account: EmailMailboxSettings): boolean {
  return account.enabled && !!normalizeMailHost(account.imap.host);
}

export function getActiveMailbox(state: Pick<EmailAccountStore, "mailboxes" | "activeMailboxId">) {
  if (state.mailboxes.length === 0) return defaultEmailMailboxSettings({ label: "Primary mailbox" });
  return (
    state.mailboxes.find((mb) => mb.id === state.activeMailboxId) ?? state.mailboxes[0]
  );
}
