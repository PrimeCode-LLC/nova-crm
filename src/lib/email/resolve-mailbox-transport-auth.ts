import { resolveMailboxGoogleAccessTokenServer } from "@/lib/email/mailbox-google-oauth-server";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";

export type MailboxTransportAuth = {
  user: string;
  pass: string;
  accessToken?: string;
};

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

  if (input.mailboxId) {
    const oauth = await resolveMailboxGoogleAccessTokenServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
    });
    if (oauth) {
      return { user: oauth.user, pass: "", accessToken: oauth.accessToken };
    }

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
    }
  }

  return { user, pass };
}
