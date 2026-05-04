export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface EmailAccountSettings {
  /** Master switch, when off, mail UI stays in setup mode */
  enabled: boolean;
  displayName: string;
  emailAddress: string;
  replyTo: string;
  smtp: SmtpConfig;
  imap: ImapConfig;
  /** Default signature appended to outbound mail */
  signature: string;
  /** Reserved for background sync (IMAP IDLE / polling) */
  syncIntervalMinutes: number;
  /** Future: move thread to archive folder on send */
  archiveOnSend: boolean;
  /** Future: track opens via pixel (off by default) */
  readReceipts: boolean;
}

export const defaultEmailAccountSettings = (): EmailAccountSettings => ({
  enabled: false,
  displayName: "",
  emailAddress: "",
  replyTo: "",
  smtp: {
    host: "",
    port: 587,
    secure: false,
    user: "",
    password: "",
  },
  imap: {
    host: "",
    port: 993,
    secure: true,
    user: "",
    password: "",
  },
  signature: "",
  syncIntervalMinutes: 15,
  archiveOnSend: false,
  readReceipts: false,
});

export interface MailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  updatedAt: string;
}

export interface MailSent {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

/** Message loaded from the mailbox via IMAP (server round-trip). */
export interface MailInbound {
  id: string;
  uid: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  seen: boolean;
  preview: string;
  bodyText: string;
  bodyHtml?: string;
}
