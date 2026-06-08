import type { ImapFlow } from "imapflow";

function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\s+/g, " ");
}

function scoreSentPath(path: string): number {
  const p = normalizePath(path);
  if (p.includes("[gmail]/sent mail")) return 20;
  if (p === "[gmail]/sent mail") return 20;
  if (p.endsWith("/sent mail")) return 18;
  if (p === "sent" || p.endsWith("/sent") || p.endsWith(".sent")) return 14;
  if (p.includes("sent items")) return 13;
  if (p.includes("sent messages")) return 12;
  if (p.includes("inbox.sent")) return 11;
  if (p.includes("sent-mail")) return 10;
  if (p.includes(" sent") && p.includes("mail")) return 8;
  return 0;
}

function hasSentSpecialUse(specialUse: string | string[] | undefined): boolean {
  if (!specialUse) return false;
  const list = Array.isArray(specialUse) ? specialUse : [specialUse];
  return list.some((s) => String(s).toLowerCase().replace(/\\/g, "") === "sent");
}

async function sentFolderMessageCount(client: ImapFlow, path: string): Promise<number> {
  try {
    const status = await client.status(path, { messages: true });
    return typeof status.messages === "number" && Number.isFinite(status.messages) ? status.messages : 0;
  } catch {
    return -1;
  }
}

function collectSentFolderCandidates(boxes: Awaited<ReturnType<ImapFlow["list"]>>): string[] {
  const withSpecial = boxes.filter((b) => hasSentSpecialUse(b.specialUse as string | string[] | undefined));
  const paths = new Set<string>();

  if (withSpecial.length > 0) {
    const ranked = [...withSpecial].sort(
      (a, b) => scoreSentPath(b.path) - scoreSentPath(a.path),
    );
    for (const b of ranked) {
      if (b.path) paths.add(b.path);
    }
  } else {
    const ranked = [...boxes]
      .filter((b) => scoreSentPath(b.path) > 0)
      .sort((a, b) => scoreSentPath(b.path) - scoreSentPath(a.path));
    for (const b of ranked) {
      if (b.path) paths.add(b.path);
    }
  }

  return [...paths];
}

/**
 * Pick the server Sent folder path (Gmail, Outlook, generic IMAP).
 * Always returns a path exactly as reported by LIST (required for Gmail namespaces).
 * When multiple Sent mailboxes exist, prefers the one with the most messages so Gmail web
 * sent mail is not missed in favor of an empty provider-specific folder.
 */
export async function resolveSentMailboxPath(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();
  const candidates = collectSentFolderCandidates(boxes);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  let bestPath = candidates[0]!;
  let bestCount = await sentFolderMessageCount(client, bestPath);
  for (const path of candidates.slice(1)) {
    const count = await sentFolderMessageCount(client, path);
    if (count > bestCount) {
      bestCount = count;
      bestPath = path;
    }
  }
  return bestPath;
}
