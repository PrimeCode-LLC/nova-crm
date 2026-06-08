import { ImapFlow } from "imapflow";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import { resolveSentMailboxPath } from "@/lib/email/resolve-sent-mailbox";

export type AppendSentMailInput = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  imap: { host: string; port: number; secure: boolean; user: string; pass: string };
  rawMessage: Buffer;
};

/** Save a copy of an outbound message to the provider's Sent folder via IMAP APPEND. */
export async function appendSentMailServer(
  input: AppendSentMailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = normalizeMailHost(input.imap.host);
  let user = input.imap.user.trim();
  let pass = input.imap.pass;
  if (input.mailboxId) {
    const secrets = await getMailboxSecretsServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
    });
    if (secrets) {
      const fromVault = secrets.imap.user.trim();
      if (fromVault) user = fromVault;
      if (secrets.imap.password) pass = secrets.imap.password;
    }
  }

  if (!host || !user) {
    return { ok: false, error: "IMAP host and username are required to save to Sent." };
  }

  const client = new ImapFlow(
    imapFlowConnectionOptions({
      host,
      port: input.imap.port,
      secure: input.imap.secure,
      user,
      pass,
      purpose: "fetch",
    }),
  );
  client.on("error", () => undefined);

  try {
    await client.connect();
    const sentPath = await resolveSentMailboxPath(client);
    if (!sentPath) {
      return { ok: false, error: "Could not find a Sent folder on this mail account." };
    }

    const result = await client.append(sentPath, input.rawMessage, ["\\Seen"], new Date());
    if (result === false) {
      return { ok: false, error: "The mail server rejected saving the message to Sent." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: formatImapError(e) };
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}
