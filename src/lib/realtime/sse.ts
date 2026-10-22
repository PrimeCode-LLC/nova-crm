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

/** Collections whose changes are pushed to every open tab in the workspace. */
export const WORKSPACE_LIVE_COLLECTIONS = new Set(["workspaceChatMessages", "workspaceChatChannels"]);

export function workspaceTopic(organizationId: string): string {
  return `realtime:org:${organizationId}:workspace`;
}

/**
 * Tell open tabs a workspace collection changed (RT-01). Carries only the
 * collection name — clients re-fetch through the scoped API, so private rows
 * are never broadcast.
 */
export async function publishWorkspaceChange(organizationId: string, collection: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await redis.publish(workspaceTopic(organizationId), JSON.stringify({ collection }));
}

