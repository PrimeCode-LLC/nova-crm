import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "@/lib/db/document-shim/shim-client-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";
import { mapUserNotificationDoc } from "@/lib/notifications/persist-user-notification-client";
import type { UserNotificationDoc } from "@/lib/notifications/user-notification-types";

const MAX_ROWS = 80;

export function subscribeUserNotifications(
  db: Firestore,
  organizationId: string,
  recipientId: string,
  onData: (rows: UserNotificationDoc[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, COLLECTIONS.userNotifications),
    where("organizationId", "==", organizationId),
    where("recipientId", "==", recipientId),
    orderBy("createdAt", "desc"),
    limit(MAX_ROWS),
  );

  return onSnapshot(
    q,
    (snap) => {
      const rows: UserNotificationDoc[] = [];
      for (const d of snap.docs) {
        const mapped = mapUserNotificationDoc(d.id, d.data() as Record<string, unknown>);
        if (!mapped) continue;
        if (mapped.dismissedAt) continue;
        rows.push(mapped);
      }
      onData(rows);
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}
