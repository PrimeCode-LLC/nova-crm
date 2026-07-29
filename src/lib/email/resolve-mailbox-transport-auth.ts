import {
  resolveMailboxGoogleAccessTokenServer,
  type GoogleMailAuthFailureReason,
} from "@/lib/email/mailbox-google-oauth-server";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import { getMailboxProfileServer } from "@/lib/email/mailbox-profiles-server";

export type MailboxTransportAuth = {
  user: string;
  pass: string;
  accessToken?: string;
  /** Set when Google OAuth was expected / present but could not produce a usable token. */
  googleAuthFailure?: GoogleMailAuthFailureReason;
};

function googleAuthFailureMessage(reason: GoogleMailAuthFailureReason | undefined): string {
  switch (reason) {
    case "not_configured":
      return "Google mail OAuth is not configured on the server. Add GOOGLE_CALENDAR_CLIENT_ID / SECRET (or GOOGLE_MAIL_*), then reconnect.";
    case "refresh_failed":
      return "Google sign-in expired for this mailbox. Reconnect with Sign in with Google in Settings → Email.";
    case "expired":
      return "Google access expired for this mailbox. Reconnect with Sign in with Google in Settings → Email.";
    case "no_account_email":
      return "Google mailbox is missing its account email. Reconnect with Sign in with Google in Settings → Email.";
    case "no_tokens":
    default:
      return "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.";
  }
}

export { googleAuthFailureMessage };

/** Prefer Google OAuth access token when present; otherwise vault username/password. */
export async function resolveMailboxTransportAuthServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  fallbackUser?: string;
  fallbackPass?: string;
  /** Which vault username to prefer when not using OAuth. */
  prefer?: "smtp" | "imap";
}): Promise<MailboxTransportAuth> {
  const prefer = input.prefer ?? "smtp";
  let user = (input.fallbackUser ?? "").trim();
  let pass = input.fallbackPass ?? "";
  let googleAuthFailure: GoogleMailAuthFailureReason | undefined;

  if (input.mailboxId) {
    const detail: { reason?: GoogleMailAuthFailureReason } = {};
    const oauth = await resolveMailboxGoogleAccessTokenServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
      detail,
    });
    if (oauth) {
      return { user: oauth.user, pass: "", accessToken: oauth.accessToken };
    }
    googleAuthFailure = detail.reason;

    const secrets = await getMailboxSecretsServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
    });
    if (secrets) {
      const fromVault = (prefer === "imap" ? secrets.imap.user : secrets.smtp.user).trim();
      if (fromVault) user = fromVault;
      const vaultPass = prefer === "imap" ? secrets.imap.password : secrets.smtp.password;
      if (vaultPass) pass = vaultPass;
      if (prefer === "imap" && !pass && secrets.smtp.password) pass = secrets.smtp.password;
      if (prefer === "smtp" && !user && secrets.imap.user.trim()) user = secrets.imap.user.trim();
      if (!user && secrets.googleOAuth?.accountEmail.trim()) {
        user = secrets.googleOAuth.accountEmail.trim();
      }
    }

    if (!user) {
      const profile = await getMailboxProfileServer({
        organizationId: input.organizationId,
        uid: input.uid,
        mailboxId: input.mailboxId,
      });
      const fromProfile = profile?.emailAddress.trim() || "";
      if (fromProfile) user = fromProfile;
    }
  }

  return { user, pass, ...(googleAuthFailure ? { googleAuthFailure } : {}) };
}
