import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  mergePermissions,
  type Override,
  type Role,
} from "./mergePermissions";

export {
  cleanupProspectImportTemporaryData,
  processProspectImportChunk,
} from "./prospectImportWorker";

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

/** Keeps sequence status aligned with manual and automated follow-up completion. */
export const reconcileFollowupPlanOnFollowupWrite = onDocumentWritten(
  "followups/{followupId}",
  async (event) => {
    const before = event.data?.before.data() as Record<string, unknown> | undefined;
    const after = event.data?.after.data() as Record<string, unknown> | undefined;
    if (!after) return;

    const planId = typeof after.planId === "string" ? after.planId.trim() : "";
    if (!planId) return;
    const wasDone = before?.completedAt != null || before?.deliveryStatus === "sent";
    const isDone = after.completedAt != null || after.deliveryStatus === "sent";
    if (before?.planId === after.planId && wasDone === isDone) return;

    const [steps, planSnap] = await Promise.all([
      db.collection("followups").where("planId", "==", planId).get(),
      db.collection("followupPlans").doc(planId).get(),
    ]);
    if (steps.empty || !planSnap.exists) return;

    const plan = planSnap.data() as Record<string, unknown>;
    const status = String(plan.status ?? "");
    const allDone = steps.docs.every((doc) => {
      const step = doc.data() as Record<string, unknown>;
      return step.completedAt != null || step.deliveryStatus === "sent";
    });
    const now = new Date().toISOString();

    if (allDone && status === "active") {
      await planSnap.ref.update({ status: "completed", completedAt: now, updatedAt: now });
    } else if (!allDone && status === "completed") {
      await planSnap.ref.update({
        status: "active",
        completedAt: FieldValue.delete(),
        updatedAt: now,
      });
    }
  },
);
