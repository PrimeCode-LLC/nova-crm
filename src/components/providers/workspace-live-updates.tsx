"use client";

import * as React from "react";
import { refreshCollectionListeners } from "@/lib/db/document-shim/shim-client-firestore";

const LIVE_COLLECTIONS = ["workspaceChatMessages", "workspaceChatChannels"];

/**
 * Live chat (RT-01 / RT-03): the server pushes "collection changed" signals on
 * the workspace stream; refresh those listeners right away. EventSource
 * reconnects by itself, and each (re)connect re-fetches so messages sent while
 * offline appear.
 */
export function WorkspaceLiveUpdates() {
  React.useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/realtime/stream?channel=workspace");
    source.onopen = () => LIVE_COLLECTIONS.forEach(refreshCollectionListeners);
    source.onmessage = (event) => {
      try {
        const { collection } = JSON.parse(event.data) as { collection?: string };
        if (collection && LIVE_COLLECTIONS.includes(collection)) refreshCollectionListeners(collection);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => source.close();
  }, []);
  return null;
}
