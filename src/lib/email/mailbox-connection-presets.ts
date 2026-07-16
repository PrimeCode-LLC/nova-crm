import type { EmailMailboxSettings, ImapConfig, SmtpConfig } from "@/lib/email-account-types";

export const GOOGLE_WORKSPACE_DEFAULT_DAILY_SEND_LIMIT = 50;
/** Outlook.com / Microsoft 365 recipient limits vary; keep a conservative default like Google. */
export const MICROSOFT_OUTLOOK_DEFAULT_DAILY_SEND_LIMIT = 50;

export const GOOGLE_WORKSPACE_PRESET = {
  smtp: { host: "smtp.gmail.com", port: 587, secure: false } as const,
  imap: { host: "imap.gmail.com", port: 993, secure: true } as const,
};

export const MICROSOFT_OUTLOOK_PRESET = {
  smtp: { host: "smtp.office365.com", port: 587, secure: false } as const,
  imap: { host: "outlook.office365.com", port: 993, secure: true } as const,
};

function applyHostPreset(
  mailbox: EmailMailboxSettings,
  preset: {
    smtp: { host: string; port: number; secure: boolean };
    imap: { host: string; port: number; secure: boolean };
  },
): Pick<EmailMailboxSettings, "smtp" | "imap"> {
  const email = mailbox.emailAddress.trim();
  const smtpUser = email || mailbox.smtp.user.trim();
  const imapUser = email || mailbox.imap.user.trim() || smtpUser;
  const smtp: SmtpConfig = {
    host: preset.smtp.host,
    port: preset.smtp.port,
    secure: preset.smtp.secure,
    user: smtpUser,
    password: mailbox.smtp.password,
  };
  const imap: ImapConfig = {
    host: preset.imap.host,
    port: preset.imap.port,
    secure: preset.imap.secure,
    user: imapUser,
    password: mailbox.imap.password || mailbox.smtp.password,
  };
  return { smtp, imap };
}

/** Apply Gmail SMTP/IMAP hosts; keep existing passwords; sync usernames from the From address when set. */
export function applyGoogleWorkspacePreset(
  mailbox: EmailMailboxSettings,
): Pick<EmailMailboxSettings, "smtp" | "imap"> {
  return applyHostPreset(mailbox, GOOGLE_WORKSPACE_PRESET);
}

/** Apply Outlook / Microsoft 365 SMTP/IMAP hosts. */
export function applyMicrosoftOutlookPreset(
  mailbox: EmailMailboxSettings,
): Pick<EmailMailboxSettings, "smtp" | "imap"> {
  return applyHostPreset(mailbox, MICROSOFT_OUTLOOK_PRESET);
}

export function withGoogleWorkspaceConnection(
  mailbox: EmailMailboxSettings,
): EmailMailboxSettings {
  const hosts = applyGoogleWorkspacePreset(mailbox);
  return {
    ...mailbox,
    connectionType: "google_workspace",
    dailySendLimit:
      mailbox.dailySendLimit === undefined
        ? GOOGLE_WORKSPACE_DEFAULT_DAILY_SEND_LIMIT
        : mailbox.dailySendLimit,
    ...hosts,
  };
}

export function withMicrosoftOutlookConnection(
  mailbox: EmailMailboxSettings,
): EmailMailboxSettings {
  const hosts = applyMicrosoftOutlookPreset(mailbox);
  return {
    ...mailbox,
    connectionType: "microsoft_outlook",
    dailySendLimit:
      mailbox.dailySendLimit === undefined
        ? MICROSOFT_OUTLOOK_DEFAULT_DAILY_SEND_LIMIT
        : mailbox.dailySendLimit,
    ...hosts,
  };
}
