/**
 * Deterministic hints for the inbound reply classifier.
 *
 * The model still decides, but cheap regex/thread facts stop the common
 * misreads: a reply that came from a different person, an unsubscribe buried
 * under a polite sentence, or a "next quarter" brush-off with no real date.
 */

const AUTO_REPLY_RE =
  /\b(out of (the )?office|automatic reply|auto[- ]?reply|on (annual |parental )?leave|on vacation|maternity leave|away from my desk)\b/i;
const OPT_OUT_RE =
  /\b(unsubscribe|remove me|take me off|stop (emailing|contacting)|do not (contact|email)|opt me out|no longer (wish|want) to receive)\b/i;
const LEGAL_RE = /\b(gdpr|ccpa|legal action|report(ed)? (you|this) as spam|spam complaint)\b/i;
const SCHEDULING_RE =
  /\b(calendly|cal\.com|hubspot\.com\/meetings|book (a|some) time|schedule (a )?(call|meeting|time)|set up a (call|meeting)|my calendar|send (me )?(an )?invite|what times|available (on|at|this|next)|works for me|happy to (chat|talk|connect))\b/i;
const PRICING_RE = /\b(pricing|price|quote|rates?|cost|budget|proposal|sow|statement of work)\b/i;
const REFERRAL_RE =
  /\b(not the right person|wrong person|reach out to|forwarded (this|your email)|looping in|cc'?ing|my colleague|speak (to|with) [A-Z]|handles? this|takes care of this)\b/i;
const TIMING_RE =
  /\b(next (quarter|month|year)|q[1-4]\b|after the (holidays|new year)|circle back in|revisit in|not (right )?now|bad timing|too early)\b/i;
const HAVE_VENDOR_RE =
  /\b(we (already )?(have|use|work with)|current (vendor|provider|agency|partner)|in[- ]house team|under contract)\b/i;
const NEGATIVE_RE =
  /\b(not interested|no thanks|no thank you|pass on this|not a fit|don'?t need|stop)\b/i;
const SELLING_TO_US_RE =
  /\b(our (agency|company|team) (can|could|offers?|provides?)|we (offer|provide|specialize)|check out our (services|portfolio)|hire (us|our team)|our rates? (start|are))\b/i;

function emailAddress(header: string): string {
  const angle = header.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  const bare = header.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return bare?.[0]?.trim().toLowerCase() ?? "";
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

function daysBetween(fromIso: string | undefined, toIso: string): number | null {
  if (!fromIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type InboundReplySignalInput = {
  from: string;
  subject: string;
  /** Body with the quoted trail already removed. */
  body: string;
  receivedAt: string;
  leadContactEmail?: string;
  /** Chronological thread facts (excluding the message being classified). */
  inboundCount?: number;
  outboundCount?: number;
  firstOutboundAt?: string;
  lastOutboundAt?: string;
  hadQuotedTrail?: boolean;
  doNotContact?: boolean;
};

/**
 * A compact, model-readable hint block. Every line is a heuristic, so the
 * prompt tells the model the email text wins on conflict.
 */
export function buildInboundReplySignalBlock(input: InboundReplySignalInput): string {
  const body = (input.body || "").trim();
  const blob = `${input.subject}\n${body}`;
  const sender = emailAddress(input.from);
  const leadEmail = (input.leadContactEmail || "").trim().toLowerCase();
  const words = body ? body.split(/\s+/).filter(Boolean).length : 0;

  const senderMatch = !leadEmail
    ? "unknown (no contact email on the lead)"
    : sender === leadEmail
      ? "yes (same person we emailed)"
      : domainOf(sender) && domainOf(sender) === domainOf(leadEmail)
        ? "no, but same company domain (likely a colleague or delegate)"
        : "no (different person or domain than the lead contact)";

  const lines = [
    `Reply length: ${words} words${words <= 12 ? " (very short: read tone carefully, do not over-read enthusiasm)" : ""}`,
    `Questions asked by them: ${(body.match(/\?/g) ?? []).length}`,
    `Sender is the lead contact: ${senderMatch}`,
    `Prior messages in thread: ${input.outboundCount ?? 0} from us, ${input.inboundCount ?? 0} from them`,
    `Days since our first touch: ${daysBetween(input.firstOutboundAt, input.receivedAt) ?? "unknown"}`,
    `Days since our last touch: ${daysBetween(input.lastOutboundAt, input.receivedAt) ?? "unknown"}`,
    `Quoted trail removed before you: ${input.hadQuotedTrail ? "yes" : "no"}`,
    `Lead marked do-not-contact: ${input.doNotContact ? "yes" : "no"}`,
  ];

  const flags: string[] = [];
  if (AUTO_REPLY_RE.test(blob)) flags.push("auto-reply / out-of-office language");
  if (OPT_OUT_RE.test(body)) flags.push("opt-out or unsubscribe request language");
  if (LEGAL_RE.test(body)) flags.push("legal / spam-complaint language");
  if (SCHEDULING_RE.test(body)) flags.push("scheduling or availability language");
  if (PRICING_RE.test(body)) flags.push("pricing, budget, or proposal language");
  if (REFERRAL_RE.test(body)) flags.push("referral / wrong-person / delegation language");
  if (TIMING_RE.test(body)) flags.push("timing deferral language");
  if (HAVE_VENDOR_RE.test(body)) flags.push("existing vendor or in-house team language");
  if (NEGATIVE_RE.test(body)) flags.push("explicit rejection language");
  if (SELLING_TO_US_RE.test(body)) flags.push("they may be selling to us (inbound vendor pitch)");

  lines.push(
    `Detected language flags: ${flags.length ? flags.join("; ") : "none"}`,
    "These are regex heuristics. When a flag and the actual wording disagree, trust the wording.",
  );

  return lines.join("\n");
}
