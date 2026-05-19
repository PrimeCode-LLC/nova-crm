import dns from "node:dns/promises";
import net from "node:net";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";

/**
 * Prefer IPv4 for the SMTP TCP connect. Nodemailer otherwise picks a random A/AAAA record;
 * broken IPv6 routes are common while IMAP (imapflow) may still succeed on IPv4 first.
 * When connecting by IP, callers should pass `tlsServername` into transport `tls.servername`
 * for SNI and certificate validation.
 */
export async function resolveSmtpConnectHost(rawHost: string): Promise<{
  connectHost: string;
  tlsServername: string;
}> {
  const name = normalizeMailHost(rawHost);
  if (!name || net.isIP(name)) {
    return { connectHost: name, tlsServername: name };
  }

  try {
    const { address } = await dns.lookup(name, { family: 4 });
    return { connectHost: address, tlsServername: name };
  } catch {
    return { connectHost: name, tlsServername: name };
  }
}
