/**
 * Append a mailbox signature to outbound email body.
 * Keeps AI / followup drafts signature-free; apply only at schedule/send time.
 */
export function appendMailboxSignature(
  body: string,
  signature: string | undefined | null,
): string {
  const text = body.replace(/\s+$/u, "");
  const sig = signature?.replace(/^\s+|\s+$/gu, "") ?? "";
  if (!sig) return text;
  // Avoid double-append when body already ends with this signature.
  const normalizedBody = text.replace(/\s+$/u, "");
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
