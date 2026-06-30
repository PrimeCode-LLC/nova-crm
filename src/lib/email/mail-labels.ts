import type { MailDraft, MailInbound, MailSent } from "@/lib/email-account-types";
import { crmLabelColorByIndex } from "@/lib/crm-label-colors";

export type MailLabel = {
  id: string;
  name: string;
  color: string;
};

export type MailLabelFolder = "inbox" | "trash" | "sent" | "drafts" | "scheduled";

export function createMailLabelId(): string {
  return `ml-${crypto.randomUUID()}`;
}

export function defaultMailLabelColor(index: number): string {
  return crmLabelColorByIndex(index);
}

/** Stable key for persisting label assignments on a mailbox message. */
export function inboundMessageMetaKey(mailboxId: string, message: Pick<MailInbound, "id">): string {
  return `${mailboxId}:in:${message.id}`;
}

export function trashMessageMetaKey(mailboxId: string, message: Pick<MailInbound, "id">): string {
  return `${mailboxId}:trash:${message.id}`;
}

export function messageMetaKeysForInbound(
  mailboxId: string,
  message: MailInbound,
  folder: "inbox" | "trash",
): string[] {
  return [folder === "trash" ? trashMessageMetaKey(mailboxId, message) : inboundMessageMetaKey(mailboxId, message)];
}

export type MailListRowLike = {
  thread?: { messages: MailInbound[] };
  row: MailDraft | MailSent | MailInbound | { id: string };
  scheduled?: { id: string };
};

export function collectMessageMetaKeysFromRow(
  row: MailListRowLike,
  mailboxId: string,
  folder: MailLabelFolder,
): string[] {
  const keys: string[] = [];
  if (row.thread) {
    for (const m of row.thread.messages) {
      if (folder === "trash") keys.push(trashMessageMetaKey(mailboxId, m));
      else keys.push(inboundMessageMetaKey(mailboxId, m));
    }
    return keys;
  }
  const item = row.row;
  if ("uid" in item && "date" in item) {
    const m = item as MailInbound;
    if (folder === "trash") keys.push(trashMessageMetaKey(mailboxId, m));
    else keys.push(inboundMessageMetaKey(mailboxId, m));
  } else if ("sentAt" in item) {
    keys.push((item as MailSent).id);
  } else if ("updatedAt" in item && "mailboxId" in item) {
    keys.push((item as MailDraft).id);
  } else if (row.scheduled) {
    keys.push(row.scheduled.id);
  }
  return keys;
}

export function labelIdsForRow(
  row: MailListRowLike,
  mailboxId: string,
  folder: MailLabelFolder,
  labelsByMessageId: Record<string, string[]>,
): string[] {
  const keys = collectMessageMetaKeysFromRow(row, mailboxId, folder);
  const out = new Set<string>();
  for (const key of keys) {
    for (const id of labelsByMessageId[key] ?? []) out.add(id);
  }
  return [...out];
}

export function rowHasMailLabel(
  row: MailListRowLike,
  mailboxId: string,
  folder: MailLabelFolder,
  labelsByMessageId: Record<string, string[]>,
  labelId: string,
): boolean {
  return labelIdsForRow(row, mailboxId, folder, labelsByMessageId).includes(labelId);
}

export function countMessagesWithLabel(
  rows: MailListRowLike[],
  mailboxId: string,
  folder: MailLabelFolder,
  labelsByMessageId: Record<string, string[]>,
  labelId: string,
): number {
  let n = 0;
  for (const row of rows) {
    if (rowHasMailLabel(row, mailboxId, folder, labelsByMessageId, labelId)) n += 1;
  }
  return n;
}

export function parseMailLabelsFromFirestore(raw: unknown): MailLabel[] {
  if (!Array.isArray(raw)) return [];
  const out: MailLabel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const name = String(o.name ?? "").trim();
    if (!id || !name) continue;
    const color = String(o.color ?? defaultMailLabelColor(out.length)).trim();
    out.push({ id, name, color });
  }
  return out;
}

export function parseLabelsByMessageIdFromFirestore(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(val)) continue;
    const ids = val.map((v) => String(v).trim()).filter(Boolean);
    if (ids.length > 0) out[key] = ids;
  }
  return out;
}
