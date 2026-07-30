/**
 * Strip the quoted trail (and trailing signature) from an inbound email body.
 *
 * Classification and reply drafting only care about what the prospect actually
 * typed. Leaving our own quoted pitch in the body skews the model (our copy
 * reads as their intent) and wastes thousands of tokens per thread.
 */

const WROTE_LINE = /^\s*(on|le|el|am)\b.{0,240}\bwrote:\s*$/i;
const WROTE_PREFIX = /^\s*on\b.{0,240}$/i;
const ORIGINAL_MESSAGE = /^\s*-{2,}\s*original message\s*-{2,}\s*$/i;
const FORWARDED = /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i;
const OUTLOOK_DIVIDER = /^\s*_{10,}\s*$/;
const HEADER_FROM = /^\s*(from|von|de)\s*:\s*.+$/i;
const HEADER_FOLLOWER = /^\s*(sent|date|to|subject|cc|gesendet|an)\s*:\s*/i;
const SIGNATURE_DELIM = /^\s*--\s*$/;
const MOBILE_SIGNATURE = /^\s*(sent from my |get outlook for |sent via )/i;

function isQuoteBoundary(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (ORIGINAL_MESSAGE.test(line) || FORWARDED.test(line) || OUTLOOK_DIVIDER.test(line)) {
    return true;
  }
  if (WROTE_LINE.test(line)) return true;
  // Gmail wraps long attribution lines, so "wrote:" can land on the next line.
  if (WROTE_PREFIX.test(line) && /\bwrote:\s*$/i.test(lines[index + 1] ?? "")) return true;
  if (HEADER_FROM.test(line)) {
    for (let i = index + 1; i <= index + 4 && i < lines.length; i += 1) {
      if (HEADER_FOLLOWER.test(lines[i] ?? "")) return true;
    }
  }
  return false;
}

export type StrippedReply = {
  text: string;
  /** A quoted trail or forwarded block was removed. */
  hadQuotedTrail: boolean;
  /** A trailing signature block was removed. */
  hadSignature: boolean;
};

export function stripQuotedReply(raw: string): StrippedReply {
  const source = (raw ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return { text: "", hadQuotedTrail: false, hadSignature: false };

  const lines = source.split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (isQuoteBoundary(lines, i)) {
      cut = i;
      break;
    }
  }

  let kept = lines.slice(0, cut);
  const hadQuotedTrail = cut < lines.length;

  // Drop any straggling ">" quoted lines above the boundary.
  const beforeQuoteStrip = kept.length;
  kept = kept.filter((line) => !/^\s*>/.test(line));
  const strippedInlineQuotes = kept.length !== beforeQuoteStrip;

  let hadSignature = false;
  const sigAt = kept.findIndex(
    (line, i) => i > 0 && (SIGNATURE_DELIM.test(line) || MOBILE_SIGNATURE.test(line)),
  );
  if (sigAt > 0) {
    kept = kept.slice(0, sigAt);
    hadSignature = true;
  }

  const text = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Never hand back nothing: a reply that is only a quote is better than empty.
  if (!text) {
    return {
      text: source.replace(/\n{3,}/g, "\n\n").trim(),
      hadQuotedTrail: false,
      hadSignature: false,
    };
  }

  return {
    text,
    hadQuotedTrail: hadQuotedTrail || strippedInlineQuotes,
    hadSignature,
  };
}

/** Convenience for context blocks where only the text matters. */
export function replyTextOnly(raw: string): string {
  return stripQuotedReply(raw).text;
}
