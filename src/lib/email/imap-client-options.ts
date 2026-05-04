import type { ImapFlowOptions } from "imapflow";

const CONNECTION_MS = 12_000;
const GREETING_MS = 12_000;
/** Short idle limit — fine for connect + verify + light commands. */
const SOCKET_MS = 25_000;
/** Listing/fetching many messages can leave the socket idle longer than 25s on slow hosts. */
const SOCKET_MS_FETCH = 180_000;

/** Shared options so IMAP connect/search doesn’t hang on bad host/port like SMTP did. */
export function imapFlowConnectionOptions(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** Use `fetch` when downloading many bodies so imapflow doesn’t hit “Socket timeout” mid-fetch. */
  purpose?: "verify" | "fetch";
}): ImapFlowOptions {
  const socketTimeout = input.purpose === "fetch" ? SOCKET_MS_FETCH : SOCKET_MS;
  return {
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.user, pass: input.pass },
    logger: false,
    connectionTimeout: CONNECTION_MS,
    greetingTimeout: GREETING_MS,
    socketTimeout,
  };
}

/** imapflow throws AuthenticationFailure, but the package entry does not export that class — use shape check. */
function isImapAuthenticationFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "authenticationFailed" in err &&
    (err as { authenticationFailed?: unknown }).authenticationFailed === true
  );
}

/** Optional short line from the server (helps users see “invalid credentials” vs “blocked”). */
function imapServerResponseSnippet(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const r = (err as { response?: unknown }).response;
  if (typeof r !== "string" || !r.trim()) return undefined;
  const oneLine = r.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

const IMAP_AUTH_ACTION =
  "Use your full email as the IMAP username (when in doubt), re-type the mailbox password, and with Google/Microsoft 2FA create an app password and paste that instead of your normal login.";

function formatImapLoginRejected(err: unknown): string {
  const server = imapServerResponseSnippet(err);

  /* Standard IMAP reply — don’t repeat “authentication failed” three times in one toast. */
  if (server && /AUTHENTICATIONFAILED|Authentication failed/i.test(server)) {
    return `${server.trim()} ${IMAP_AUTH_ACTION}`;
  }

  const base = `The mail server rejected this IMAP login. ${IMAP_AUTH_ACTION}`;
  return server ? `${base} (${server})` : base;
}

function messageLooksLikeImapAuthFailure(msg: string): boolean {
  return (
    /AUTHENTICATIONFAILED/i.test(msg) ||
    /\b5\.7\.[0-9]\b/.test(msg) ||
    /\b535\b/.test(msg) ||
    /Invalid credentials/i.test(msg) ||
    /Username and Password not accepted/i.test(msg) ||
    /\[AUTHENTICATIONFAILED\]/i.test(msg) ||
    /\bAUTHENTICATION failed\b/i.test(msg)
  );
}

export function formatImapError(err: unknown): string {
  if (isImapAuthenticationFailure(err)) {
    return formatImapLoginRejected(err);
  }

  if (!(err instanceof Error)) return "IMAP operation failed";

  const code = (err as NodeJS.ErrnoException).code;
  const msg = err.message || "";

  /* Node uses ETIMEDOUT; imapflow uses ETIMEOUT for socket idle timeout */
  if (code === "ETIMEDOUT" || code === "ETIMEOUT" || /socket timeout|timeout/i.test(msg)) {
    return "IMAP timed out — check host/port/TLS and firewall. If the mailbox is large or slow, try again; we allow extra time while downloading mail.";
  }
  if (code === "ECONNREFUSED") {
    return "IMAP connection refused — wrong port or server not accepting IMAP on this address.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "IMAP host not found — check the hostname spelling.";
  }
  if (messageLooksLikeImapAuthFailure(msg)) {
    return formatImapLoginRejected(err);
  }
  if (/certificate|SSL|TLS|UNABLE_TO_VERIFY_LEAF_SIGNATURE|self signed/i.test(msg)) {
    return "IMAP TLS error — try port 993 with TLS on; some hosts need STARTTLS on port 143 with TLS off.";
  }
  if (/Unknown mailbox|MAILBOX.*not found|nonexistent.*mailbox|Folder not found/i.test(msg)) {
    return "Could not open the mail folder — your provider may use a different name than INBOX for the main folder.";
  }

  return msg.length > 280 ? `${msg.slice(0, 280)}…` : msg;
}
