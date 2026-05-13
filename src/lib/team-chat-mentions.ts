import type { User } from "@/lib/types";

const MENTION_RE = /@\[([^\]\s]+)\]/g;

export function extractMentionUserIds(text: string): string[] {
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    ids.push(m[1]!);
  }
  return Array.from(new Set(ids));
}

export function formatChatBodySegments(
  body: string,
  usersById: Map<string, Pick<User, "displayName">>,
): { type: "text" | "mention"; value: string; userId?: string }[] {
  const segments: { type: "text" | "mention"; value: string; userId?: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) {
      segments.push({ type: "text", value: body.slice(last, m.index) });
    }
    const uid = m[1]!;
    const label = usersById.get(uid)?.displayName?.trim() || "teammate";
    segments.push({ type: "mention", value: `@${label}`, userId: uid });
    last = m.index + m[0].length;
  }
  if (last < body.length) {
    segments.push({ type: "text", value: body.slice(last) });
  }
  if (segments.length === 0) {
    segments.push({ type: "text", value: body });
  }
  return segments;
}
