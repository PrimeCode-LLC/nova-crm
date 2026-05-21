import type { MailInbound } from "@/lib/email-account-types";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";

/** Normalize a domain for block-list storage and comparison. */
export function normalizeBlockedSenderDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  const noAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return normalizeMailHost(noAt).toLowerCase();
}

function extractEmailFromFromHeader(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  const bare = fromHeader.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return bare?.[0]?.trim().toLowerCase() ?? "";
}

/** Domain part of the sender address (e.g. `team@bark.com` → `bark.com`). */
export function extractSenderDomain(fromHeader: string): string {
  const email = extractEmailFromFromHeader(fromHeader);
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return normalizeBlockedSenderDomain(email.slice(at + 1));
}

export function isSenderDomainBlocked(fromHeader: string, blockedDomains: readonly string[]): boolean {
  const domain = extractSenderDomain(fromHeader);
  if (!domain) return false;
  const set = new Set(blockedDomains.map(normalizeBlockedSenderDomain).filter(Boolean));
  return set.has(domain);
}

export function buildBlockedDomainSet(blockedDomains: readonly string[]): Set<string> {
  return new Set(blockedDomains.map(normalizeBlockedSenderDomain).filter(Boolean));
}

/** Split inbox rows: keep visible vs move to trash because sender domain is blocked. */
export function partitionInboxByBlockedDomains(
  messages: MailInbound[],
  blockedDomains: readonly string[],
): { visible: MailInbound[]; blockedUids: number[] } {
  const blocked = buildBlockedDomainSet(blockedDomains);
  if (blocked.size === 0) {
    return { visible: messages, blockedUids: [] };
  }
  const visible: MailInbound[] = [];
  const blockedUids: number[] = [];
  for (const m of messages) {
    const domain = extractSenderDomain(m.from);
    if (domain && blocked.has(domain)) {
      blockedUids.push(m.uid);
    } else {
      visible.push(m);
    }
  }
  return { visible, blockedUids };
}

export function collectBlockedUidsFromInbound(
  messages: readonly MailInbound[],
  blockedDomains: readonly string[],
): number[] {
  const blocked = buildBlockedDomainSet(blockedDomains);
  if (blocked.size === 0) return [];
  const uids: number[] = [];
  for (const m of messages) {
    const domain = extractSenderDomain(m.from);
    if (domain && blocked.has(domain)) uids.push(m.uid);
  }
  return uids;
}
