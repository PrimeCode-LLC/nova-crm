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
import {
  idleSalesLeadsContributionDelta,
  openSalesLeadsContributionDelta,
  type OpenSalesLeadFields,
} from "./openSalesLeads";
import {
  dealWriteAffectsOpenPipeline,
  leadWriteAffectsOpenPipeline,
  leadWriteAffectsPipelineByStage,
  type PipelineDealFields,
  type PipelineLeadFields,
} from "./openPipeline";
import { recomputeOrgDashboardSummaryForOrg } from "./orgDashboardSummary";

export {
  cleanupProspectImportTemporaryData,
  processProspectImportChunk,
} from "./prospectImportWorker";

export {
  runDueScrapers,
  sendDueScheduledEmails,
  syncInboxImapHeads,
  sendContentCaptureReminders,
} from "./appHostingCron";

export { runOrgScrapers } from "./runOrgScrapersHttp";

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
 * Legacy resource-scope merge for older clients.
 * Skips overwrite when the Roles catalog already wrote `modules`/`actions`
 * (see `writeComputedPermissions` in the Next app).
 */
export const recomputePermissionsOnUserWrite = onDocumentWritten(
  "users/{userId}",
  async (event) => {
    const userId = event.params.userId;
    const after = event.data?.after?.data() as { roleId?: Role } | undefined;
    if (!after?.roleId) return;

    const existing = await db.collection("computedPermissions").doc(userId).get();
    if (existing.exists && existing.data()?.modules) {
      // Roles catalog owns this document - do not clobber with legacy shape.
      return;
    }

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

    const organizationId =
      (typeof after?.organizationId === "string" && after.organizationId.trim()) ||
      (typeof before?.organizationId === "string" && before.organizationId.trim()) ||
      "";

    if (after) {
      const planId = typeof after.planId === "string" ? after.planId.trim() : "";
      if (planId) {
        const wasDone = before?.completedAt != null || before?.deliveryStatus === "sent";
        const isDone = after.completedAt != null || after.deliveryStatus === "sent";
        if (!(before?.planId === after.planId && wasDone === isDone)) {
          const [steps, planSnap] = await Promise.all([
            db.collection("followups").where("planId", "==", planId).get(),
            db.collection("followupPlans").doc(planId).get(),
          ]);
          if (!steps.empty && planSnap.exists) {
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
          }
        }
      }
    }

    // P0.10 — refresh sent/due/range gauges when follow-up KPI fields change.
    if (organizationId) {
      const kpiTouched =
        !before ||
        !after ||
        before.deliveryStatus !== after.deliveryStatus ||
        before.sentAt !== after.sentAt ||
        before.dueAt !== after.dueAt ||
        before.completedAt !== after.completedAt ||
        before.pausedAt !== after.pausedAt;
      if (kpiTouched) {
        await recomputeOrgDashboardSummaryForOrg(db, organizationId);
      }
    }
  },
);

/**
 * Phase 0 — full org dashboard summary recompute on lead writes (P0.4–P0.10).
 */
export const syncOpenSalesLeadsOnLeadWrite = onDocumentWritten(
  "leads/{leadId}",
  async (event) => {
    const leadId = event.params.leadId as string;
    const beforeRaw = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : undefined;
    const afterRaw = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : undefined;

    const organizationId =
      (typeof afterRaw?.organizationId === "string" && afterRaw.organizationId.trim()) ||
      (typeof beforeRaw?.organizationId === "string" && beforeRaw.organizationId.trim()) ||
      "";
    if (!organizationId) return;

    const before: OpenSalesLeadFields | null = beforeRaw
      ? {
          intakeKind: typeof beforeRaw.intakeKind === "string" ? beforeRaw.intakeKind : null,
          stage: typeof beforeRaw.stage === "string" ? beforeRaw.stage : null,
          isIdle: typeof beforeRaw.isIdle === "boolean" ? beforeRaw.isIdle : null,
        }
      : null;
    const after: OpenSalesLeadFields | null = afterRaw
      ? {
          intakeKind: typeof afterRaw.intakeKind === "string" ? afterRaw.intakeKind : null,
          stage: typeof afterRaw.stage === "string" ? afterRaw.stage : null,
          isIdle: typeof afterRaw.isIdle === "boolean" ? afterRaw.isIdle : null,
        }
      : null;

    const openDelta = openSalesLeadsContributionDelta(before, after);
    const idleDelta = idleSalesLeadsContributionDelta(before, after);

    const beforePipe: PipelineLeadFields | null = beforeRaw
      ? {
          id: leadId,
          intakeKind: typeof beforeRaw.intakeKind === "string" ? beforeRaw.intakeKind : null,
          stage: typeof beforeRaw.stage === "string" ? beforeRaw.stage : null,
          estimatedValue:
            typeof beforeRaw.estimatedValue === "number" ? beforeRaw.estimatedValue : null,
        }
      : null;
    const afterPipe: PipelineLeadFields | null = afterRaw
      ? {
          id: leadId,
          intakeKind: typeof afterRaw.intakeKind === "string" ? afterRaw.intakeKind : null,
          stage: typeof afterRaw.stage === "string" ? afterRaw.stage : null,
          estimatedValue:
            typeof afterRaw.estimatedValue === "number" ? afterRaw.estimatedValue : null,
        }
      : null;

    const channelBefore = typeof beforeRaw?.channel === "string" ? beforeRaw.channel : null;
    const channelAfter = typeof afterRaw?.channel === "string" ? afterRaw.channel : null;
    const replyBefore = typeof beforeRaw?.lastReplyAt === "string" ? beforeRaw.lastReplyAt : null;
    const replyAfter = typeof afterRaw?.lastReplyAt === "string" ? afterRaw.lastReplyAt : null;
    const reviewBefore =
      typeof beforeRaw?.replyReviewStatus === "string" ? beforeRaw.replyReviewStatus : null;
    const reviewAfter =
      typeof afterRaw?.replyReviewStatus === "string" ? afterRaw.replyReviewStatus : null;

    const touched =
      openDelta !== 0 ||
      idleDelta !== 0 ||
      leadWriteAffectsOpenPipeline(beforePipe, afterPipe) ||
      leadWriteAffectsPipelineByStage(beforePipe, afterPipe) ||
      channelBefore !== channelAfter ||
      replyBefore !== replyAfter ||
      reviewBefore !== reviewAfter ||
      Boolean(beforeRaw) !== Boolean(afterRaw);

    if (!touched) return;
    await recomputeOrgDashboardSummaryForOrg(db, organizationId);
  },
);

/**
 * Phase 0 — full org dashboard summary recompute when deals change.
 */
export const syncOpenPipelineOnDealWrite = onDocumentWritten(
  "deals/{dealId}",
  async (event) => {
    const beforeRaw = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : undefined;
    const afterRaw = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : undefined;

    const organizationId =
      (typeof afterRaw?.organizationId === "string" && afterRaw.organizationId.trim()) ||
      (typeof beforeRaw?.organizationId === "string" && beforeRaw.organizationId.trim()) ||
      "";
    if (!organizationId) return;

    const before: PipelineDealFields | null = beforeRaw
      ? {
          leadId: typeof beforeRaw.leadId === "string" ? beforeRaw.leadId : null,
          stage: typeof beforeRaw.stage === "string" ? beforeRaw.stage : null,
          value: typeof beforeRaw.value === "number" ? beforeRaw.value : null,
        }
      : null;
    const after: PipelineDealFields | null = afterRaw
      ? {
          leadId: typeof afterRaw.leadId === "string" ? afterRaw.leadId : null,
          stage: typeof afterRaw.stage === "string" ? afterRaw.stage : null,
          value: typeof afterRaw.value === "number" ? afterRaw.value : null,
        }
      : null;

    if (!dealWriteAffectsOpenPipeline(before, after)) return;
    await recomputeOrgDashboardSummaryForOrg(db, organizationId);
  },
);
