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

export interface EmailMailboxSettings extends EmailAccountSettings {
  id: string;
  label: string;
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

/** Parsed attachment from IMAP (small files may include base64 for download in the browser). */
export interface MailInboundAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Present when small enough to ship in the API response for client-side download. */
  contentBase64?: string;
}

export interface MailDraft {
  id: string;
  mailboxId: string;
  to: string;
  /** Optional Cc line (comma-separated addresses). */
  cc?: string;
  subject: string;
  body: string;
  updatedAt: string;
}

export interface MailSent {
  id: string;
  mailboxId: string;
  from: string;
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
  cc?: string;
  date: string;
  seen: boolean;
  preview: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: MailInboundAttachment[];
  /** Normalized RFC 5322 Message-ID without angle brackets (when available). */
  messageId?: string;
  inReplyTo?: string;
  /** Ordered Message-IDs from References header (normalized). */
  referenceIds?: string[];
  /**
   * When false, only headers were loaded in bulk sync; opening the thread fetches the body.
   * Omitted/true means `bodyText` is already synced.
   */
  bodySynced?: boolean;
  /** Raw List-Unsubscribe header when available (RFC 2369). */
  listUnsubscribe?: string;
}

export function defaultEmailMailboxSettings(partial?: Partial<EmailMailboxSettings>): EmailMailboxSettings {
  const base = defaultEmailAccountSettings();
  return {
    id: partial?.id ?? `mb-${crypto.randomUUID()}`,
    label: partial?.label ?? "Mailbox",
    ...base,
    ...partial,
    smtp: { ...base.smtp, ...(partial?.smtp ?? {}) },
    imap: { ...base.imap, ...(partial?.imap ?? {}) },
  };
}
