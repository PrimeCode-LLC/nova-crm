import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  type EmailAccountSettings,
  type MailDraft,
  type MailSent,
  defaultEmailAccountSettings,
} from "@/lib/email-account-types";

export interface EmailAccountStore {
  account: EmailAccountSettings;
  drafts: MailDraft[];
  sent: MailSent[];
  setAccount: (patch: Partial<EmailAccountSettings>) => void;
  setSmtp: (patch: Partial<EmailAccountSettings["smtp"]>) => void;
  setImap: (patch: Partial<EmailAccountSettings["imap"]>) => void;
  upsertDraft: (draft: Omit<MailDraft, "id" | "updatedAt"> & { id?: string }) => string;
  deleteDraft: (id: string) => void;
  addSent: (item: Omit<MailSent, "id" | "sentAt">) => string;
  clearLocalMail: () => void;
}

export const useEmailAccountStore = create<EmailAccountStore>()(
  persist(
    (set, get) => ({
      account: defaultEmailAccountSettings(),
      drafts: [],
      sent: [],
      setAccount: (patch) =>
        set({ account: { ...get().account, ...patch } }),
      setSmtp: (patch) =>
        set({ account: { ...get().account, smtp: { ...get().account.smtp, ...patch } } }),
      setImap: (patch) =>
        set({ account: { ...get().account, imap: { ...get().account.imap, ...patch } } }),
      upsertDraft: ({ id, to, subject, body }) => {
        const draftId = id ?? `d-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const prev = get().drafts;
        const idx = prev.findIndex((d) => d.id === draftId);
        const row: MailDraft = { id: draftId, to, subject, body, updatedAt: now };
        if (idx === -1) set({ drafts: [row, ...prev] });
        else {
          const next = [...prev];
          next[idx] = row;
          set({ drafts: next });
        }
        return draftId;
      },
      deleteDraft: (id) =>
        set({ drafts: get().drafts.filter((d) => d.id !== id) }),
      addSent: (item) => {
        const id = `s-${crypto.randomUUID()}`;
        const sentAt = new Date().toISOString();
        set({ sent: [{ ...item, id, sentAt }, ...get().sent] });
        return id;
      },
      clearLocalMail: () => set({ drafts: [], sent: [] }),
    }),
    {
      name: "nova-crm-email-account",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ account: s.account, drafts: s.drafts, sent: s.sent }),
    },
  ),
);

export function isEmailAccountConfigured(account: EmailAccountSettings): boolean {
  return (
    account.enabled &&
    !!account.emailAddress.trim() &&
    !!account.smtp.host.trim() &&
    !!account.smtp.user.trim()
  );
}
