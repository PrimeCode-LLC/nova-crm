/**
 * Attribute a reply to the outreach config of the most recent sent event
 * for that lead before the reply timestamp (avoids double-counting when a
 * lead was touched by multiple configs).
 */

export type SentForAttribution = {
  leadId: string | null;
  createdAt: Date;
  /** Prefer meta.configId from the sent event; fall back to followup→config map. */
  configId?: string | null;
  followupId?: string | null;
};

/**
 * Returns the configId that should receive credit for this reply, or null
 * if no prior send can be attributed.
 */
export function attributeReplyToConfig(input: {
  leadId: string;
  replyAt: Date;
  sentEvents: SentForAttribution[];
  followupToConfig?: Map<string, string>;
}): string | null {
  const leadId = input.leadId.trim();
  if (!leadId) return null;
  const replyMs = input.replyAt.getTime();

  let best: { at: number; configId: string } | null = null;
  for (const sent of input.sentEvents) {
    if (!sent.leadId || sent.leadId !== leadId) continue;
    const at = sent.createdAt.getTime();
    if (at > replyMs) continue;

    const fromMeta = typeof sent.configId === "string" ? sent.configId.trim() : "";
    const fromFollowup =
      sent.followupId && input.followupToConfig
        ? (input.followupToConfig.get(sent.followupId) ?? "")
        : "";
    const configId = fromMeta || fromFollowup;
    if (!configId) continue;

    if (!best || at > best.at) {
      best = { at, configId };
    }
  }
  return best?.configId ?? null;
}
