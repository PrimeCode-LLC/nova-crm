import net from "node:net";
import nodemailer from "nodemailer";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { resolveSmtpConnectHost } from "@/lib/email/smtp-connect-target";
import { smtpTransportOptions } from "@/lib/email/smtp-client-options";

function isSmtpConnectTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  const msg = err.message || "";
  return code === "ETIMEDOUT" || /connection timeout|socket timeout/i.test(msg);
}

type SmtpCred = {
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  accessToken?: string;
};

/**
 * Try SMTP connect + `fn`. If the TCP phase times out on an IPv4 literal, retry with the
 * hostname so Nodemailer can use IPv6 / its own A+AAAA fallback — IMAP may already work that way.
 */
export async function runWithSmtpTransporter<T>(
  fqdnHost: string,
  cred: SmtpCred,
  fn: (transporter: nodemailer.Transporter) => Promise<T>,
): Promise<T> {
  const name = normalizeMailHost(fqdnHost);
  if (!name) throw new Error("SMTP host required");

  const { connectHost, tlsServername } = await resolveSmtpConnectHost(name);

  const attempts: { host: string; tlsServername?: string }[] = [];

  if (net.isIP(connectHost) && !net.isIP(name)) {
    attempts.push({
      host: connectHost,
      tlsServername: net.isIP(tlsServername) ? undefined : tlsServername,
    });
  }

  attempts.push({ host: name });

  const seen = new Set<string>();
  const unique = attempts.filter((a) => {
    const k = `${a.host}\0${a.tlsServername ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let lastErr: unknown;
  for (let i = 0; i < unique.length; i++) {
    const a = unique[i];
    const transporter = nodemailer.createTransport(
      smtpTransportOptions({
        host: a.host,
        port: cred.port,
        secure: cred.secure,
        user: cred.user,
        pass: cred.pass,
        accessToken: cred.accessToken,
        tlsServername: a.tlsServername,
      }),
    );
    try {
      return await fn(transporter);
    } catch (e) {
      lastErr = e;
      if (i < unique.length - 1 && isSmtpConnectTimeout(e)) continue;
      throw e;
    }
  }
  throw lastErr;
}
