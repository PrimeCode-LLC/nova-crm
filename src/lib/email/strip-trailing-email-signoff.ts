/**
 * Remove a trailing email closing (e.g. "Best,", "Thanks,") from a draft body.
 * Mailbox signatures usually already include the closing + name block, so AI
 * (and sometimes reps) leave a duplicate "Best," right above the signature.
 */
const TRAILING_SIGNOFF_RE =
  /(?:\r?\n|^)[ \t]*(?:best(?:\s+regards)?|kind\s+regards|warm\s+regards|warmly|thanks(?:\s+again)?|thank\s+you|cheers|sincerely|respectfully|regards|all\s+the\s+best)[,!.]?\s*$/iu;

export function stripTrailingEmailSignOff(body: string): string {
  let text = body.replace(/\s+$/u, "");
  // One pass is enough for normal drafts; loop covers "Thanks,\nBest," edge cases.
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(TRAILING_SIGNOFF_RE, "").replace(/\s+$/u, "");
    if (next === text) break;
    text = next;
  }
  return text;
}
