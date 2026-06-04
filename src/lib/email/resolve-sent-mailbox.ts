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

/**
 * Pick the server Sent folder path (Gmail, Outlook, generic IMAP).
 * Always returns a path exactly as reported by LIST (required for Gmail namespaces).
 */
export async function resolveSentMailboxPath(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();

  const withSpecial = boxes.filter((b) => hasSentSpecialUse(b.specialUse as string | string[] | undefined));
  if (withSpecial.length === 1 && withSpecial[0]?.path) {
    return withSpecial[0].path;
  }
  if (withSpecial.length > 1) {
    let best = withSpecial[0]!;
    let bestScore = scoreSentPath(best.path);
    for (const b of withSpecial.slice(1)) {
      const s = scoreSentPath(b.path);
      if (s > bestScore) {
        bestScore = s;
        best = b;
      }
    }
    return best.path;
  }

  let best: (typeof boxes)[number] | null = null;
  let bestScore = 0;
  for (const b of boxes) {
    const s = scoreSentPath(b.path);
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  return bestScore > 0 && best?.path ? best.path : null;
}
