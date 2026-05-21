import type { MailInbound } from "@/lib/email-account-types";

function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function decodeHtmlAttr(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripHtmlToText(fragment: string): string {
  return fragment
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function textSignalsUnsubscribe(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("unsubscribe") ||
    t.includes("opt out") ||
    t.includes("opt-out") ||
    t.includes("email preferences") ||
    t.includes("manage preferences") ||
    t.includes("stop receiving")
  );
}

function scoreUnsubscribeUrl(url: string, contextScore: number): number {
  const lower = url.toLowerCase();
  let score = contextScore;
  if (lower.includes("unsubscribe")) score += 4;
  if (lower.includes("opt-out") || lower.includes("optout")) score += 3;
  if (lower.includes("preferences")) score += 2;
  if (lower.includes("beehiiv.com")) score += 2;
  if (lower.includes("list-manage.com") || lower.includes("mailchimp")) score += 2;
  if (lower.includes("sendgrid.net") || lower.includes("cmail")) score += 1;
  return score;
}

/** Parse RFC 2369 List-Unsubscribe; prefer HTTPS one-click URLs. */
export function parseListUnsubscribeHeader(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const candidates: string[] = [];
  for (const m of raw.matchAll(/<([^>]+)>/g)) {
    const inner = m[1]?.trim();
    if (inner) candidates.push(inner);
  }
  if (candidates.length === 0) {
    for (const m of raw.matchAll(/(https?:\/\/[^\s>,]+)/gi)) {
      if (m[1]) candidates.push(m[1].trim());
    }
  }
  const scored = candidates
    .map((url) => decodeHtmlAttr(url))
    .filter(isSafeHttpUrl)
    .map((url) => ({ url, score: scoreUnsubscribeUrl(url, 5) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.url ?? null;
}

/** Links whose href or visible/aria text indicates unsubscribe (Beehiiv, Mailchimp, etc.). */
function extractUnsubscribeFromHtml(html: string): string | null {
  if (!html.trim()) return null;

  const ranked: { url: string; score: number }[] = [];

  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;
    const url = decodeHtmlAttr(hrefMatch[1].trim());
    if (!isSafeHttpUrl(url)) continue;

    const innerText = stripHtmlToText(inner);
    const aria =
      attrs.match(/\baria-label=["']([^"']+)["']/i)?.[1] ??
      attrs.match(/\btitle=["']([^"']+)["']/i)?.[1] ??
      "";
    const labelText = stripHtmlToText(aria);

    let contextScore = 0;
    if (textSignalsUnsubscribe(innerText)) contextScore += 6;
    if (textSignalsUnsubscribe(labelText)) contextScore += 5;
    if (contextScore === 0) continue;

    ranked.push({ url, score: scoreUnsubscribeUrl(url, contextScore) });
  }

  // Some newsletters use a table/button layout: href on one line, "Unsubscribe" nearby.
  const hrefRe = /\bhref=["'](https?:\/\/[^"']+)["']/gi;
  for (const m of html.matchAll(hrefRe)) {
    const url = decodeHtmlAttr(m[1]?.trim() ?? "");
    if (!isSafeHttpUrl(url)) continue;
    const start = Math.max(0, (m.index ?? 0) - 280);
    const end = Math.min(html.length, (m.index ?? 0) + 420);
    const nearby = stripHtmlToText(html.slice(start, end));
    if (!textSignalsUnsubscribe(nearby)) continue;
    ranked.push({ url, score: scoreUnsubscribeUrl(url, 4) });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.url ?? null;
}

const BODY_HREF_IN_URL_PATTERNS = [
  /href=["']([^"']*(?:unsubscribe|opt[-_]?out|manage[-_]?preferences|email[-_]?preferences)[^"']*)["']/gi,
  /(https?:\/\/[^\s"'<>]+(?:unsubscribe|opt[-_]?out|manage[-_]?preferences)[^\s"'<>]*)/gi,
];

function extractUnsubscribeFromPlainText(text: string): string | null {
  const lines = text.split(/\n/);
  for (const line of lines) {
    if (!textSignalsUnsubscribe(line)) continue;
    const urlMatch = line.match(/(https?:\/\/[^\s)>]+)/i);
    if (urlMatch?.[1] && isSafeHttpUrl(urlMatch[1])) return urlMatch[1];
  }
  for (const re of BODY_HREF_IN_URL_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const raw = decodeHtmlAttr((m[1] ?? "").trim());
      if (isSafeHttpUrl(raw)) return raw;
    }
  }
  return null;
}

function extractUnsubscribeFromBody(haystack: string): string | null {
  if (!haystack.trim()) return null;

  const htmlChunk = haystack.includes("<") ? haystack : "";
  if (htmlChunk) {
    const fromHtml = extractUnsubscribeFromHtml(htmlChunk);
    if (fromHtml) return fromHtml;
  }

  return extractUnsubscribeFromPlainText(haystack);
}

/** Best-effort unsubscribe URL from headers and/or message body. */
export function extractUnsubscribeUrl(message: MailInbound): string | null {
  const fromHeader = parseListUnsubscribeHeader(message.listUnsubscribe);
  if (fromHeader) return fromHeader;

  const hay = [message.bodyHtml, message.bodyText, message.preview].filter(Boolean).join("\n");
  return extractUnsubscribeFromBody(hay);
}
