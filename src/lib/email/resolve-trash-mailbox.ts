import type { ImapFlow } from "imapflow";

/**
 * Pick the server Trash folder path (Gmail, Outlook, generic IMAP).
 */
export async function resolveTrashMailboxPath(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();
  const special = boxes.find((b) => b.specialUse === "\\Trash");
  if (special?.path) return special.path;

  const scorePath = (path: string): number => {
    const p = path.toLowerCase();
    if (p === "trash" || p.endsWith("/trash") || p.endsWith(".trash")) return 12;
    if (p.includes("[gmail]/trash")) return 12;
    if (p.includes("deleted items")) return 11;
    if (p.includes("deleted messages")) return 10;
    if (p.includes("bin")) return 6;
    return 0;
  };

  let best: string | null = null;
  let bestScore = 0;
  for (const b of boxes) {
    const s = scorePath(b.path);
    if (s > bestScore) {
      bestScore = s;
      best = b.path;
    }
  }
  return bestScore > 0 ? best : null;
}
