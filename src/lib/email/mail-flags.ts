import type { MailListRowLike, MailLabelFolder } from "@/lib/email/mail-labels";
import { collectMessageMetaKeysFromRow } from "@/lib/email/mail-labels";

export const MAIL_FLAG_IDS = [
  "orange",
  "red",
  "purple",
  "blue",
  "yellow",
  "green",
  "gray",
] as const;

export type MailFlagId = (typeof MAIL_FLAG_IDS)[number];

export type MailFlagPreset = {
  id: MailFlagId;
  name: string;
  color: string;
};

/** Apple Mail–style flag colors. */
export const MAIL_FLAG_PRESETS: readonly MailFlagPreset[] = [
  { id: "orange", name: "Orange", color: "#FF9500" },
  { id: "red", name: "Red", color: "#FF3B30" },
  { id: "purple", name: "Purple", color: "#AF52DE" },
  { id: "blue", name: "Blue", color: "#007AFF" },
  { id: "yellow", name: "Yellow", color: "#FFCC00" },
  { id: "green", name: "Green", color: "#34C759" },
  { id: "gray", name: "Gray", color: "#8E8E93" },
] as const;

export const DEFAULT_MAIL_FLAG_ID: MailFlagId = "orange";

export function mailFlagById(id: string): MailFlagPreset | undefined {
  return MAIL_FLAG_PRESETS.find((f) => f.id === id);
}

export function parseFlagByMessageIdFromFirestore(raw: unknown): Record<string, MailFlagId> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, MailFlagId> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(val ?? "").trim() as MailFlagId;
    if (MAIL_FLAG_IDS.includes(id)) out[key] = id;
  }
  return out;
}

export function flagIdForMessageKey(
  messageKey: string,
  flagByMessageId: Record<string, MailFlagId>,
): MailFlagId | null {
  return flagByMessageId[messageKey] ?? null;
}

/** Prefer the latest message in a thread when showing a row flag. */
export function flagIdForRow(
  row: MailListRowLike,
  mailboxId: string,
  folder: MailLabelFolder,
  flagByMessageId: Record<string, MailFlagId>,
): MailFlagId | null {
  const keys = collectMessageMetaKeysFromRow(row, mailboxId, folder);
  if (keys.length === 0) return null;
  for (let i = keys.length - 1; i >= 0; i--) {
    const hit = flagByMessageId[keys[i]!];
    if (hit) return hit;
  }
  return null;
}

export function rowHasMailFlag(
  row: MailListRowLike,
  mailboxId: string,
  folder: MailLabelFolder,
  flagByMessageId: Record<string, MailFlagId>,
  flagId: MailFlagId,
): boolean {
  const keys = collectMessageMetaKeysFromRow(row, mailboxId, folder);
  return keys.some((key) => flagByMessageId[key] === flagId);
}

export function rowIsFlagged(
  row: MailListRowLike,
  mailboxId: string,
  folder: MailLabelFolder,
  flagByMessageId: Record<string, MailFlagId>,
): boolean {
  return flagIdForRow(row, mailboxId, folder, flagByMessageId) != null;
}

export function countMessagesWithFlag(
  rows: MailListRowLike[],
  mailboxId: string,
  folder: MailLabelFolder,
  flagByMessageId: Record<string, MailFlagId>,
  flagId: MailFlagId,
): number {
  let n = 0;
  for (const row of rows) {
    if (rowHasMailFlag(row, mailboxId, folder, flagByMessageId, flagId)) n += 1;
  }
  return n;
}

export function countFlaggedMessages(
  rows: MailListRowLike[],
  mailboxId: string,
  folder: MailLabelFolder,
  flagByMessageId: Record<string, MailFlagId>,
): number {
  let n = 0;
  for (const row of rows) {
    if (rowIsFlagged(row, mailboxId, folder, flagByMessageId)) n += 1;
  }
  return n;
}
