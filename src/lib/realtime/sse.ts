/**
 * Realtime pub/sub helpers (P7.7).
 */

import { getRedis } from "@/lib/cache/redis";

/** Publish a realtime event to subscribed SSE clients. */
export async function publishRealtimeEvent(
  organizationId: string,
  channel: string,
  uid: string,
  payload: unknown,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  const topic = `realtime:org:${organizationId}:${channel}:${uid}`;
  await redis.publish(topic, JSON.stringify(payload));
}
