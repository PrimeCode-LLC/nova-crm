/** Durable engagement tracking for CRM-sent mail (opens / clicks). */

export type MailTrackingLink = {
  id: string;
  url: string;
};

export type MailTrackingRecipientRole = "to" | "cc" | "bcc";

export type MailTrackingRecipientInput = {
  email: string;
  role: MailTrackingRecipientRole;
};

export type MailTrackingRecipientEngagement = {
  /** Short id encoded in open/click tokens (not the email address). */
  id: string;
  email: string;
  role: MailTrackingRecipientRole;
  openCount: number;
  clickCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
  firstClickedAt?: string;
  lastClickedAt?: string;
};

export type MailTrackingMessage = {
  id: string;
  organizationId: string;
  messageId: string;
  mailboxId: string;
  mailboxOwnerUid: string;
  leadId?: string;
  followupId?: string;
  scheduledEmailId?: string;
  trackOpens: boolean;
  trackClicks: boolean;
  links: MailTrackingLink[];
  recipients?: MailTrackingRecipientEngagement[];
  openCount: number;
  clickCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
  firstClickedAt?: string;
  lastClickedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MailTrackingSummary = {
  messageId: string;
  trackOpens: boolean;
  trackClicks: boolean;
  openCount: number;
  clickCount: number;
  opened: boolean;
  clicked: boolean;
  firstOpenedAt?: string;
  firstClickedAt?: string;
  recipients?: MailTrackingRecipientEngagement[];
};

export type MailTrackingContext = {
  trackOpens: boolean;
  trackClicks: boolean;
  leadId?: string;
  followupId?: string;
  scheduledEmailId?: string;
};
