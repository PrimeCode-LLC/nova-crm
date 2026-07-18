import { stripTrailingEmailSignOff } from "@/lib/email/strip-trailing-email-signoff";

/**
 * Append a mailbox signature to outbound email body.
 * Keeps AI / followup drafts signature-free; apply only at schedule/send time.
 * Also strips a trailing "Best," / "Thanks," etc. so it does not duplicate the
 * closing already present in most mailbox signatures.
 */
export function appendMailboxSignature(
  body: string,
  signature: string | undefined | null,
): string {
  const text = stripTrailingEmailSignOff(body);
  const sig = signature?.replace(/^\s+|\s+$/gu, "") ?? "";
  if (!sig) return text;
  // Avoid double-append when body already ends with this signature.
  const normalizedBody = text;
  const normalizedSig = sig;
  if (
    normalizedBody === normalizedSig ||
    normalizedBody.endsWith(`\n\n${normalizedSig}`) ||
    normalizedBody.endsWith(normalizedSig)
  ) {
    return normalizedBody;
  }
  return `${normalizedBody}\n\n${normalizedSig}`;
}

export function mailboxSignatureTrimmed(signature: string | undefined | null): string {
  return signature?.replace(/^\s+|\s+$/gu, "") ?? "";
}

/** Shared compliance / opt-out footer (all inboxes). */
export function globalEmailFooterTrimmed(footer: string | undefined | null): string {
  return footer?.replace(/^\s+|\s+$/gu, "") ?? "";
}

/**
 * Append the account-wide email footer after body (and signature, if already applied).
 */
export function appendGlobalEmailFooter(
  body: string,
  footer: string | undefined | null,
): string {
  const text = body.replace(/\s+$/u, "");
  const foot = globalEmailFooterTrimmed(footer);
  if (!foot) return text;
  if (
    text === foot ||
    text.endsWith(`\n\n${foot}`) ||
    text.endsWith(foot)
  ) {
    return text;
  }
  return `${text}\n\n${foot}`;
}
