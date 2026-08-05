/** True when stored/displayed copy is only the subject (or empty) — not a real body. */
export function isSubjectOnlyMailBody(input: {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
}): boolean {
  if (input.bodyHtml?.trim()) return false;
  const body = (input.bodyText ?? "").replace(/\s+/g, " ").trim();
  if (!body) return true;
  if (body.length > 160) return false;
  const subject = (input.subject ?? "").replace(/\s+/g, " ").trim();
  if (!subject) return false;
  return body === subject || body === subject.slice(0, body.length);
}

/** Keep a previously stored real body when an incoming upsert is a header/subject stub. */
export function shouldKeepPreviousMailBody(input: {
  prev?: { subject?: string; bodyText?: string; bodyHtml?: string; bodySynced?: boolean };
  incoming: { subject?: string; bodyText?: string; bodyHtml?: string; bodySynced?: boolean };
}): boolean {
  const prev = input.prev;
  if (!prev) return false;
  const prevHasRealBody =
    Boolean(prev.bodyText?.trim() || prev.bodyHtml?.trim()) &&
    !isSubjectOnlyMailBody({
      subject: prev.subject || input.incoming.subject,
      bodyText: prev.bodyText,
      bodyHtml: prev.bodyHtml,
    });
  if (!prevHasRealBody) return false;

  const incomingSynced =
    input.incoming.bodySynced !== false &&
    Boolean(input.incoming.bodyText?.trim() || input.incoming.bodyHtml?.trim());
  if (!incomingSynced) return true;

  return isSubjectOnlyMailBody({
    subject: input.incoming.subject || prev.subject,
    bodyText: input.incoming.bodyText,
    bodyHtml: input.incoming.bodyHtml,
  });
}
