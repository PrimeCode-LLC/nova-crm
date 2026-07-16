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

/** How this mailbox is connected in Settings (presets vs full SMTP/IMAP). */
export type MailboxConnectionType = "google_workspace" | "microsoft_outlook" | "custom";

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
  /** Background IMAP poll interval (minutes) while the app is open */
  syncIntervalMinutes: number;
  /** Future: move thread to archive folder on send */
  archiveOnSend: boolean;
  /** Future: track opens via pixel (off by default) */
  readReceipts: boolean;
  /**
   * Google Workspace / Microsoft Outlook: hosts autofilled; Custom: full SMTP/IMAP.
   * Existing mailboxes default to custom.
   */
  connectionType: MailboxConnectionType;
  /** Max successful sends per UTC calendar day; `null` = unlimited. */
  dailySendLimit: number | null;
  /** Workspace member UIDs who may view/send this mailbox (credentials stay with owner). */
  assignedUserIds: string[];
  /** True when Google OAuth (XOAUTH2) tokens are stored for this mailbox. */
  googleAuthConnected?: boolean;
}

export interface EmailMailboxSettings extends EmailAccountSettings {
  id: string;
  label: string;
  /**
   * Set on API responses when this mailbox is owned by another member and assigned to the viewer.
   * Not persisted on the owner's Firestore profile.
   */
  dataOwnerUid?: string;
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
  connectionType: "custom",
  dailySendLimit: null,
  assignedUserIds: [],
});

/** Parsed attachment from IMAP (small files may include base64 for download in the browser). */
export interface MailInboundAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Present when small enough to ship in the API response for client-side download. */
  contentBase64?: string;
}

export interface MailDraftAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
}

export interface MailDraft {
  id: string;
  mailboxId: string;
  to: string;
  /** Optional Cc line (comma-separated addresses). */
  cc?: string;
  subject: string;
  body: string;
  attachments?: MailDraftAttachment[];
  updatedAt: string;
  /** RFC 5322 threading context retained when a reply is saved as a draft. */
  inReplyTo?: string;
  referenceIds?: string[];
}

export interface MailSent {
  id: string;
  mailboxId: string;
  from: string;
  replyTo?: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  sentAt: string;
  /** Set when loaded from the server Sent folder (IMAP). */
  uid?: number;
  bodySynced?: boolean;
  preview?: string;
  bodyHtml?: string;
  attachments?: MailInboundAttachment[];
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
}

export type ScheduledEmailStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";

export interface ScheduledEmailAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

/** Outbound email queued for future delivery (server-backed in live mode). */
export interface ScheduledEmail {
  id: string;
  mailboxId: string;
  from: string;
  displayName?: string;
  replyTo?: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  text?: string;
  html?: string;
  attachments?: ScheduledEmailAttachment[];
  scheduledAt: string;
  status: ScheduledEmailStatus;
  createdAt: string;
  sentAt?: string;
  error?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** When created from a lead follow-up, link back for UI / cron cleanup. */
  followupId?: string;
  leadId?: string;
  /** RFC 5322 threading context for a scheduled reply. */
  inReplyTo?: string;
  referenceIds?: string[];
}

/** Message loaded from the mailbox via IMAP (server round-trip). */
export interface MailInbound {
  id: string;
  uid: number;
  subject: string;
  from: string;
  replyTo?: string;
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
  const { dataOwnerUid, ...restPartial } = partial ?? {};
  return {
    id: restPartial.id ?? `mb-${crypto.randomUUID()}`,
    label: restPartial.label ?? "Mailbox",
    ...base,
    ...restPartial,
    smtp: { ...base.smtp, ...(restPartial.smtp ?? {}) },
    imap: { ...base.imap, ...(restPartial.imap ?? {}) },
    assignedUserIds: restPartial.assignedUserIds ?? base.assignedUserIds,
    dailySendLimit:
      restPartial.dailySendLimit === undefined ? base.dailySendLimit : restPartial.dailySendLimit,
    ...(dataOwnerUid ? { dataOwnerUid } : {}),
  };
}

/** True when the mailbox was assigned from another member (viewer cannot manage credentials). */
export function isAssignedMailbox(
  mailbox: EmailMailboxSettings,
  viewerUid: string | null | undefined,
): boolean {
  const owner = mailbox.dataOwnerUid?.trim();
  if (!owner || !viewerUid) return false;
  return owner !== viewerUid;
}
