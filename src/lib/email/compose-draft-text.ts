/**
 * Helpers for the manual email composer: detect user-typed reply text vs
 * signature + quoted trail, and re-merge AI output without losing the trailer.
 */

const WROTE_LINE = /^\s*(on|le|el|am)\b.{0,240}\bwrote:\s*$/i;
const WROTE_PREFIX = /^\s*on\b.{0,240}$/i;
const DASH_DELIM = /^\s*-{3,}\s*$/;
const ORIGINAL_MESSAGE = /^\s*-{2,}\s*original message\s*-{2,}\s*$/i;
const FORWARDED = /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i;
const SIG_OPEN =
  /^(best|thanks|thank you|regards|cheers|sincerely|warm regards|kind regards)\b[,!]?\s*$/i;

function quoteCutIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (DASH_DELIM.test(line) || ORIGINAL_MESSAGE.test(line) || FORWARDED.test(line)) {
      return i;
    }
    if (WROTE_LINE.test(line)) return i;
    if (WROTE_PREFIX.test(line) && /\bwrote:\s*$/i.test(lines[i + 1] ?? "")) return i;
  }
  return -1;
}

/** Drop trailing blocks that look like a mailbox signature. */
export function stripLikelyComposeSignature(text: string): string {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (!trimmed) return "";

  const blocks = trimmed.split(/\n\s*\n/);
  while (blocks.length > 0) {
    const last = (blocks[blocks.length - 1] ?? "").trim();
    if (!last) {
      blocks.pop();
      continue;
    }
    const firstLine = (last.split("\n")[0] ?? "").trim();
    const lineCount = last.split("\n").length;
    const looksLikeSignOff = SIG_OPEN.test(firstLine);
    const looksLikeTitleBlock =
      lineCount <= 5 &&
      last.length < 280 &&
      !/[.?!]/.test(last) &&
      (/\|/.test(last) || /@/.test(last) || lineCount >= 2);
    if (looksLikeSignOff || looksLikeTitleBlock) {
      blocks.pop();
      continue;
    }
    break;
  }
  return blocks.join("\n\n").trim();
}

export type SplitComposerBody = {
  /** User-typed reply above signature/quote (empty when only signature+quote). */
  userDraft: string;
  /** Signature + quoted trail to preserve after AI fills the body. */
  trail: string;
};

/**
 * Split a compose body into the user draft and the signature/quoted trailer.
 * Matches how Reply seeds the composer: optional draft, then signature, then `---` quote.
 */
export function splitComposerReplyBody(body: string): SplitComposerBody {
  const source = (body ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return { userDraft: "", trail: "" };

  const lines = source.split("\n");
  const cut = quoteCutIndex(lines);
  const prefix = (cut >= 0 ? lines.slice(0, cut).join("\n") : source).trimEnd();
  const quoteTrail = cut >= 0 ? lines.slice(cut).join("\n") : "";

  const userDraft = stripLikelyComposeSignature(prefix);
  let signatureBlock = "";
  if (userDraft) {
    const idx = prefix.lastIndexOf(userDraft);
    signatureBlock = idx >= 0 ? prefix.slice(idx + userDraft.length) : "";
  } else {
    signatureBlock = prefix;
  }

  const trailParts = [signatureBlock.replace(/^\n+/, "\n\n").trimEnd(), quoteTrail.trimEnd()].filter(
    (part) => part.trim().length > 0,
  );
  const trail = trailParts.length ? `\n\n${trailParts.join("\n\n").replace(/^\n+/, "")}` : "";

  return { userDraft, trail };
}

/** True when the composer has real reply text (not only signature / quote). */
export function composerHasUserDraft(body: string): boolean {
  return splitComposerReplyBody(body).userDraft.trim().length > 0;
}

/** Merge AI body text back with the original signature + quoted trail. */
export function mergeAiBodyIntoCompose(aiBody: string, originalComposeBody: string): string {
  const cleaned = (aiBody ?? "").trim();
  const { trail } = splitComposerReplyBody(originalComposeBody);
  if (!trail.trim()) return cleaned;
  return `${cleaned}${trail.startsWith("\n") ? trail : `\n${trail}`}`;
}
