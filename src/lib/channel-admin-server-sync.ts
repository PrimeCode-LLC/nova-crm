"use client";

import {
  getChannelAdminPersistedSnapshot,
  useChannelAdminStore,
} from "@/stores/channel-admin-store";

let lastSentChannelAdminJson = "";

export function getLastSentChannelAdminJson(): string {
  return lastSentChannelAdminJson;
}

export function markChannelAdminJsonSent(json: string): void {
  lastSentChannelAdminJson = json;
}

export type PushChannelAdminResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Persists the current channel-admin zustand snapshot to the org document (`channelAdmin`).
 * Any signed-in org member may update (same as debounced sync).
 */
export async function pushChannelAdminConfigToServer(): Promise<PushChannelAdminResult> {
  const snapshot = getChannelAdminPersistedSnapshot(useChannelAdminStore.getState());
  const json = JSON.stringify(snapshot);
  try {
    const res = await fetch("/api/org/channel-admin", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: json,
    });
    if (res.ok) {
      lastSentChannelAdminJson = json;
      return { ok: true };
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
      else if (body.error != null) message = JSON.stringify(body.error);
    } catch {
      /* keep default */
    }
    return { ok: false, error: message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
