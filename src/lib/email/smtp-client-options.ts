import net from "node:net";

/** Shared timeouts so verify/send fail fast with predictable latency. */
const CONNECTION_MS = 12_000;
const GREETING_MS = 12_000;
const SOCKET_MS = 25_000;

/**
 * Base options for nodemailer SMTP (used by verify + send).
 * Tight connection limits avoid multi-minute hangs on bad host/port.
 */
export function smtpTransportOptions(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  /** Google Workspace / Gmail XOAUTH2 access token. */
  accessToken?: string;
  /** When `host` is an IPv4 literal, set SNI / cert hostname to the mail server name. */
  tlsServername?: string;
}): {
  host: string;
  port: number;
  secure: boolean;
  auth:
    | { user: string; pass: string }
    | { type: "OAuth2"; user: string; accessToken: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  tls?: { servername: string };
} {
  const sni =
    input.tlsServername &&
    net.isIP(input.host) &&
    !net.isIP(input.tlsServername)
      ? { servername: input.tlsServername }
      : undefined;

  const accessToken = input.accessToken?.trim();
  const auth = accessToken
    ? ({ type: "OAuth2" as const, user: input.user, accessToken })
    : { user: input.user, pass: input.pass ?? "" };

  return {
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth,
    connectionTimeout: CONNECTION_MS,
    greetingTimeout: GREETING_MS,
    socketTimeout: SOCKET_MS,
    ...(sni ? { tls: sni } : {}),
  };
}

/** Turn low-level socket / SMTP errors into short, actionable copy for the UI. */
export function formatSmtpError(err: unknown): string {
  if (!(err instanceof Error)) return "SMTP verification failed";

  const code = (err as NodeJS.ErrnoException).code;
  const msg = err.message || "";

  if (code === "ETIMEDOUT" || /timeout/i.test(msg)) {
    return "Outgoing mail (SMTP) could not connect in time, receiving inbox uses IMAP, which is separate. Check the SMTP host/port and TLS mode (587 + implicit TLS off, or 465 + on), firewall/VPN blocking ports 587/465, and your provider’s outgoing-server docs.";
  }
  if (code === "ECONNREFUSED") {
    return "Connection refused, wrong port or the server is not accepting SMTP on this address.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Host not found, check the SMTP hostname spelling.";
  }
  if (
    /535|authentication failed|invalid login|auth failed|535 5\.7\.8|Username and Password not accepted/i.test(
      msg,
    )
  ) {
    return "Login rejected. Google Workspace no longer accepts normal account passwords for SMTP — use Sign in with Google (OAuth) in Settings → Email, or an app password if your admin still allows it.";
  }
  if (
    /550|5\.1\.1|5\.1\.0|no such user|user unknown|mailbox unavailable|all recipients were rejected|recipient address rejected|invalid recipient/i.test(
      msg,
    )
  ) {
    return "The mail server rejected the recipient (550). Check the To address for typos and confirm that mailbox exists. If the address is correct, your SMTP provider may not relay to that domain — verify outgoing mail settings and that your From address matches your SMTP account.";
  }
  if (/553|sender address rejected|5\.7\.1.*from/i.test(msg)) {
    return "The mail server rejected the From address. In Settings → Email, set your mailbox email to the same address you use for SMTP login.";
  }
  if (/certificate|SSL|TLS|UNABLE_TO_VERIFY_LEAF_SIGNATURE|self signed/i.test(msg)) {
    return "TLS/SSL error, try port 587 with “TLS/SSL (implicit)” off, or 465 with it on, per your provider.";
  }

  return msg.length > 280 ? `${msg.slice(0, 280)}…` : msg;
}
