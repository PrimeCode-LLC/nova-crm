/**
 * Plain-text compose body → email HTML (QA 2.6). One paragraph per line,
 * text HTML-escaped, and bare http(s)/www URLs turned into <a href> so the
 * click tracker (which only rewrites href attributes) can wrap them.
 * Shared by every composer/scheduler so behaviour and escaping match.
 */

export function escapeEmailHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Runs on already-escaped text, so URLs never contain raw < > or ".
const URL_RE = /\b(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+\.[^\s<>"]+)/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]'}]+$/;

function linkifyEscaped(escaped: string): string {
  return escaped.replace(URL_RE, (match) => {
    const trailing = match.match(TRAILING_PUNCT_RE)?.[0] ?? "";
    let url = trailing ? match.slice(0, -trailing.length) : match;
    // Keep a ")" that closes a "(" inside the URL (e.g. wiki links).
    if (trailing.startsWith(")") && url.includes("(") && !url.includes(")")) {
      url += ")";
      return `${anchor(url)}${trailing.slice(1)}`;
    }
    return `${anchor(url)}${trailing}`;
  });
}

function anchor(escapedUrl: string): string {
  const href = /^www\./i.test(escapedUrl) ? `https://${escapedUrl}` : escapedUrl;
  return `<a href="${href}">${escapedUrl}</a>`;
}

export function plainTextToEmailHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const escaped = escapeEmailHtml(line);
      return `<p>${linkifyEscaped(escaped) || "<br/>"}</p>`;
    })
    .join("");
}
