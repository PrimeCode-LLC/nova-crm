import {
  and,
  collection,
  or,
  query,
  where,
  type Firestore,
  type Query,
} from "@/lib/db/document-shim/shim-client-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";

/** Channels the signed-in user may read under `firestore.rules` (`public` or DM membership). */
export function workspaceChatChannelsForUserQuery(
  db: Firestore,
  organizationId: string,
  userId: string,
): Query {
  return query(
    collection(db, COLLECTIONS.workspaceChatChannels),
    and(
      where("organizationId", "==", organizationId),
      or(
        where("kind", "==", "public"),
        and(where("kind", "==", "dm"), where("memberIds", "array-contains", userId)),
      ),
    ),
  );
}
