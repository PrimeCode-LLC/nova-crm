import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  mergePermissions,
  type Override,
  type Role,
} from "./mergePermissions";

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

/** Smoke test + uptime checks. */
export const health = onRequest((req, res) => {
  res.json({ ok: true, service: "relay-crm-functions" });
});

/**
 * Recomputes `computedPermissions/{userId}` when a user profile changes.
 * Override documents are expected in collection `permissionOverrides` with field `userId`.
 */
export const recomputePermissionsOnUserWrite = onDocumentWritten(
  "users/{userId}",
  async (event) => {
    const userId = event.params.userId;
    const after = event.data?.after?.data() as { roleId?: Role } | undefined;
    if (!after?.roleId) return;

    const snap = await db
      .collection("permissionOverrides")
      .where("userId", "==", userId)
      .get();
    const overrides = snap.docs.map((d) => {
      const o = d.data();
      return {
        resource: o.resource,
        action: o.action,
        scope: o.scope,
        effect: o.effect,
      } as Override;
    });

    const effective = mergePermissions(after.roleId, overrides);

    await db.collection("computedPermissions").doc(userId).set({
      userId,
      effective,
      updatedAt: new Date().toISOString(),
    });
  },
);
