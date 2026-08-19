import {
  collection,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "@/lib/db/document-shim/shim-client-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { WorkspaceChatChannel } from "@/lib/types";

export type WorkspaceChatChannelMapper = (id: string, raw: Record<string, unknown>) => WorkspaceChatChannel;

/**
 * Subscribe to channels the user may read. Uses two queries (public + DM) instead of one OR
 * query so Firestore security rules can prove the result set is safe (avoids permission-denied
 * on some projects with composite OR listeners).
 */
export function subscribeWorkspaceChatChannelsForUser(
  db: Firestore,
  organizationId: string,
  userId: string,
  mapDoc: WorkspaceChatChannelMapper,
  onChannels: (channels: WorkspaceChatChannel[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  let publicRows: WorkspaceChatChannel[] = [];
  let dmRows: WorkspaceChatChannel[] = [];
  let publicReady = false;
  let dmReady = false;
  const errors: Error[] = [];

  const publish = () => {
    if (!publicReady || !dmReady) return;
    if (errors.length > 0) {
      onError(errors[0]!);
      return;
    }
    const merged = [...publicRows, ...dmRows].sort((a, b) => a.name.localeCompare(b.name));
    onChannels(merged);
  };

  const qPublic = query(
    collection(db, COLLECTIONS.workspaceChatChannels),
    where("organizationId", "==", organizationId),
    where("kind", "==", "public"),
  );
  const qDm = query(
    collection(db, COLLECTIONS.workspaceChatChannels),
    where("organizationId", "==", organizationId),
    where("kind", "==", "dm"),
    where("memberIds", "array-contains", userId),
  );

  const unsubPublic = onSnapshot(
    qPublic,
    (snap) => {
      publicRows = snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
      publicReady = true;
      publish();
    },
    (err) => {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      publicReady = true;
      publish();
    },
  );

  const unsubDm = onSnapshot(
    qDm,
    (snap) => {
      dmRows = snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
      dmReady = true;
      publish();
    },
    (err) => {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      dmReady = true;
      publish();
    },
  );

  return () => {
    unsubPublic();
    unsubDm();
  };
}
