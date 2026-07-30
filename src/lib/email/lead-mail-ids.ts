/** Stable mailbox-scoped keys for lead mail upserts (safe for client + server). */

export function leadMailProviderKey(input: {
  mailboxId: string;
  direction: "inbound" | "outbound";
  localId: string;
}): string {
  const local = input.localId.trim() || "unknown";
  const dir = input.direction === "inbound" ? "in" : "out";
  return `${input.mailboxId.trim()}:${dir}:${local}`;
}
