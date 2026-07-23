/**
 * Extract a suggested alternate email from auto-replies / "please use my new email" messages.
 * Returns the first plausible address that is not already in `knownEmails`.
 */

const EMAIL_TOKEN =
  /[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;

/** Phrases that usually introduce a replacement address. */
const SUGGESTION_CONTEXT_RE =
  /(?:new\s+e-?mail|updated?\s+e-?mail|e-?mail\s+(?:has\s+)?changed|please\s+(?:use|contact|email|reach)|reach\s+me\s+at|contact\s+me\s+(?:at|on)|email\s+me\s+at|write\s+(?:to\s+)?me\s+at|send\s+(?:future\s+)?(?:mail|emails?)\s+to|my\s+(?:new\s+)?e-?mail\s+is|use\s+this\s+(?:e-?mail|address)|forward(?:ed)?\s+to|now\s+at)\b[\s:.-]{0,40}/i;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/[>)\],;:]+$/g, "");
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSuggestedNewEmail(
  text: string,
  knownEmails: readonly string[] = [],
): string | null {
  const body = stripHtml(text);
  if (!body) return null;

  const known = new Set(knownEmails.map((e) => normalizeEmail(e)).filter(Boolean));
  const lower = body.toLowerCase();

  // Prefer emails that appear right after a "new email / contact me at" phrase.
  const contextMatches: string[] = [];
  const re = new RegExp(SUGGESTION_CONTEXT_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const slice = body.slice(m.index, m.index + m[0].length + 80);
    const found = slice.match(EMAIL_TOKEN);
    if (found) {
      for (const raw of found) {
        const email = normalizeEmail(raw);
        if (email && !known.has(email)) contextMatches.push(email);
      }
    }
  }
  if (contextMatches[0]) return contextMatches[0];

  // Fallback: only if the message clearly talks about email change and contains one unknown address.
  if (!SUGGESTION_CONTEXT_RE.test(lower) && !/\bnew\s+e-?mail\b/i.test(lower)) {
    return null;
  }

  const all = [...body.matchAll(EMAIL_TOKEN)]
    .map((x) => normalizeEmail(x[0]))
    .filter((e) => e && !known.has(e));
  const unique = [...new Set(all)];
  return unique.length === 1 ? unique[0]! : unique[0] ?? null;
}

export function findSuggestedNewEmailFromMessages(
  messages: readonly { subject?: string; preview?: string; bodyText?: string; body?: string }[],
  knownEmails: readonly string[],
): string | null {
  for (const message of messages) {
    const text = [message.subject, message.preview, message.bodyText, message.body]
      .filter(Boolean)
      .join("\n");
    const suggested = extractSuggestedNewEmail(text, knownEmails);
    if (suggested) return suggested;
  }
  return null;
}
