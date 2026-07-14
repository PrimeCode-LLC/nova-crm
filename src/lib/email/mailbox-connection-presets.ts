import type { EmailMailboxSettings, ImapConfig, SmtpConfig } from "@/lib/email-account-types";

export const GOOGLE_WORKSPACE_DEFAULT_DAILY_SEND_LIMIT = 50;

export const GOOGLE_WORKSPACE_PRESET = {
  smtp: { host: "smtp.gmail.com", port: 587, secure: false } as const,
  imap: { host: "imap.gmail.com", port: 993, secure: true } as const,
};

/** Apply Gmail SMTP/IMAP hosts; keep existing passwords; sync usernames from the From address when set. */
export function applyGoogleWorkspacePreset(
  mailbox: EmailMailboxSettings,
): Pick<EmailMailboxSettings, "smtp" | "imap"> {
  const email = mailbox.emailAddress.trim();
  const smtpUser = email || mailbox.smtp.user.trim();
  const imapUser = email || mailbox.imap.user.trim() || smtpUser;
  const smtp: SmtpConfig = {
    host: GOOGLE_WORKSPACE_PRESET.smtp.host,
    port: GOOGLE_WORKSPACE_PRESET.smtp.port,
    secure: GOOGLE_WORKSPACE_PRESET.smtp.secure,
    user: smtpUser,
    password: mailbox.smtp.password,
  };
  const imap: ImapConfig = {
    host: GOOGLE_WORKSPACE_PRESET.imap.host,
    port: GOOGLE_WORKSPACE_PRESET.imap.port,
    secure: GOOGLE_WORKSPACE_PRESET.imap.secure,
    user: imapUser,
    password: mailbox.imap.password || mailbox.smtp.password,
  };
  return { smtp, imap };
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
