/** Extract all email addresses from a RFC 5322 From/To/Cc line. */
export function extractEmailsFromMailField(field: string): Set<string> {
  const values = new Set<string>();
  const tokens = field.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const token of tokens) values.add(token.toLowerCase());
  return values;
}

/** First email on a mail header line (angle-addr or bare address). */
export function extractPrimaryEmailFromMailField(field: string): string {
  const angle = field.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  const bare = field.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return bare?.[0]?.trim().toLowerCase() ?? "";
}
