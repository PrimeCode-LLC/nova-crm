/** Durable per-lead email messages (system of record for the Emails tab). */

export type LeadMailDirection = "inbound" | "outbound";

export type LeadMailSource =
  | "imap"
  | "smtp_send"
  | "scheduled"
  | "crm_followup"
  | "instantly"
  | "client_sync"
  | "manual";

export type LeadMailMessage = {
  id: string;
  organizationId: string;
  leadId: string;
  mailboxId: string;
  mailboxOwnerUid: string;
  direction: LeadMailDirection;
  /** Stable mailbox-scoped key, e.g. `mb:in:uid-12` or `mb:out:<messageId>`. */
  providerKey: string;
  /** IMAP UID when known. */
  uid?: number;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  replyTo?: string;
  /** Message timestamp (inbound date / outbound sentAt). */
  date: string;
  seen?: boolean;
  preview: string;
  bodyText: string;
  bodyHtml?: string;
  bodySynced: boolean;
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  source: LeadMailSource;
  createdAt: string;
  updatedAt: string;
};

/** Client/API payload used to upsert into the lead mail store. */
export type LeadMailUpsertInput = {
  mailboxId: string;
  mailboxOwnerUid?: string;
  direction: LeadMailDirection;
  providerKey: string;
  uid?: number;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  replyTo?: string;
  date: string;
  seen?: boolean;
  preview?: string;
  bodyText?: string;
  bodyHtml?: string;
  bodySynced?: boolean;
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  source: LeadMailSource;
};

export const LEAD_MAIL_BODY_TEXT_MAX = 100_000;
export const LEAD_MAIL_BODY_HTML_MAX = 200_000;
export const LEAD_MAIL_PREVIEW_MAX = 500;
export const LEAD_MAIL_LIST_LIMIT = 120;
