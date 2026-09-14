/**
 * Precomputed outreach config scorecards (worker-refreshed).
 */

import { Prisma } from "@/generated/prisma/client";
import { withOrganizationScope, withRlsBypass } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { betaPosterior } from "@/lib/ai/eval/posterior";
import { attributeReplyToConfig } from "@/lib/ai/eval/reply-attribution";

const POSITIVE = new Set(["positive", "meeting_ready"]);
const ENGAGED = new Set([
  "positive",
  "meeting_ready",
  "neutral",
  "objection",
  "soft_no",
  "hard_no",
]);

export async function refreshOutreachConfigScorecard(input: {
  organizationId: string;
  configId: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const { organizationId, configId } = input;

  await withOrganizationScope(organizationId, async (tx) => {
    const provenance = await tx.sequenceStepProvenance.findMany({
      where: { organizationId, configId },
    });
    const followupIds = provenance.map((p) => p.followupId);
    const leadIds = [
      ...new Set(
        provenance
          .map((p) => p.leadId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    const followupToConfig = new Map(
      provenance.map((p) => [p.followupId, configId] as const),
    );

    // Delivery events join by followupId (sent/bounced carry it).
    const deliveryEvents =
      followupIds.length === 0
        ? []
        : await tx.emailEvent.findMany({
            where: {
              organizationId,
              followupId: { in: followupIds },
              type: { in: ["sent", "bounced", "unsubscribed"] },
            },
          });

    // Replies often lack followupId — join by leadId, then attribute to the
    // config of the most recent prior send for that lead.
    const repliedEvents =
      leadIds.length === 0
        ? []
        : await tx.emailEvent.findMany({
            where: {
              organizationId,
              leadId: { in: leadIds },
              type: "replied",
            },
          });

    // Sent events for attribution may include other configs' sends for the same leads.
    const attributionSents =
      leadIds.length === 0
        ? []
        : await tx.emailEvent.findMany({
            where: {
              organizationId,
              leadId: { in: leadIds },
              type: "sent",
            },
            select: {
              leadId: true,
              followupId: true,
              occurredAt: true,
              meta: true,
            },
          });

    // Expand followup→config for attribution sends that aren't in this config's provenance.
    const otherFollowupIds = [
      ...new Set(
        attributionSents
          .map((e) => e.followupId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .filter((id) => !followupToConfig.has(id)),
      ),
    ];
    if (otherFollowupIds.length > 0) {
      const otherProv = await tx.sequenceStepProvenance.findMany({
        where: { organizationId, followupId: { in: otherFollowupIds } },
        select: { followupId: true, configId: true },
      });
      for (const p of otherProv) {
        followupToConfig.set(p.followupId, p.configId);
      }
    }

    const sentForAttr = attributionSents.map((e) => {
      const meta = (e.meta ?? {}) as Record<string, unknown>;
      return {
        leadId: e.leadId,
        createdAt: e.occurredAt,
        followupId: e.followupId,
        configId: typeof meta.configId === "string" ? meta.configId : null,
      };
    });

    let sent = 0;
    let bounced = 0;
    let positiveReplies = 0;
    let engagedReplies = 0;
    let hardNoCount = 0;
    let unsubscribeCount = 0;
    let spamComplaintCount = 0;
    let potentialScoreSum = 0;
    const mailboxCounts = new Map<string, number>();

    for (const ev of deliveryEvents) {
      if (ev.type === "sent") {
        sent += 1;
        if (ev.mailboxId) {
          mailboxCounts.set(ev.mailboxId, (mailboxCounts.get(ev.mailboxId) ?? 0) + 1);
        }
      }
      if (ev.type === "bounced") bounced += 1;
      if (ev.type === "unsubscribed") unsubscribeCount += 1;
    }

    for (const ev of repliedEvents) {
      const leadId = ev.leadId?.trim() ?? "";
      if (!leadId) continue;
      const attributed = attributeReplyToConfig({
        leadId,
        replyAt: ev.occurredAt,
        sentEvents: sentForAttr,
        followupToConfig,
      });
      if (attributed !== configId) continue;

      const meta = (ev.meta ?? {}) as Record<string, unknown>;
      if (meta.classifiedBy === "fallback") continue;
      const classification = String(meta.classification ?? "");
      const score = Number(meta.potentialScore ?? 0);
      if (POSITIVE.has(classification)) positiveReplies += 1;
      if (ENGAGED.has(classification)) engagedReplies += 1;
      if (classification === "hard_no") hardNoCount += 1;
      if (classification === "unsubscribe_request") unsubscribeCount += 1;
      if (Number.isFinite(score)) potentialScoreSum += score;
    }

    const suppressions = await tx.emailSuppression.count({
      where: {
        organizationId,
        reason: { in: ["unsubscribe", "complaint"] },
        ...(leadIds.length > 0 ? { leadId: { in: leadIds } } : {}),
      },
    });
    unsubscribeCount = Math.max(unsubscribeCount, suppressions);

    const generations = await tx.aiGeneration.findMany({
      where: { organizationId, configId },
    });
    const generationCount = generations.length;
    const acceptedCount = generations.filter((g) => g.accepted === true).length;

    const withEdit = provenance.filter((p) => p.editDistance != null);
    const editDistanceSum = withEdit.reduce((s, p) => s + (p.editDistance ?? 0), 0);
    const editDistanceCount = withEdit.length;

    const delivered = Math.max(0, sent - bounced);
    const positiveReplyRate = delivered > 0 ? positiveReplies / delivered : 0;
    const engagedReplyRate = delivered > 0 ? engagedReplies / delivered : 0;
    const meanPotentialScore = delivered > 0 ? potentialScoreSum / delivered : 0;
    const acceptanceRate = generationCount > 0 ? acceptedCount / generationCount : 0;
    const meanEditDistance =
      editDistanceCount > 0 ? editDistanceSum / editDistanceCount : 0;
    const bounceRate = sent > 0 ? bounced / sent : 0;
    const unsubscribeRate = delivered > 0 ? unsubscribeCount / delivered : 0;
    const hardNoRate = delivered > 0 ? hardNoCount / delivered : 0;
    const spamComplaintRate = delivered > 0 ? spamComplaintCount / delivered : 0;

    const byPlan = new Map<string, typeof provenance>();
    for (const p of provenance) {
      const key = p.planId ?? p.followupId;
      const list = byPlan.get(key) ?? [];
      list.push(p);
      byPlan.set(key, list);
    }
    let maturePlans = 0;
    for (const steps of byPlan.values()) {
      if (steps.every((s) => s.sentBody != null || s.editDistance != null)) maturePlans += 1;
    }
    const maturityPct = byPlan.size > 0 ? maturePlans / byPlan.size : 0;

    const posterior = betaPosterior(positiveReplies, delivered);

    const confoundWarnings: string[] = [];
    if (sent > 20 && mailboxCounts.size > 0) {
      const top = Math.max(...mailboxCounts.values());
      if (top / sent > 0.6) {
        confoundWarnings.push(
          `Mailbox concentration: ${(100 * (top / sent)).toFixed(0)}% of sends from one mailbox`,
        );
      }
    }

    const latestEval = await tx.evalRun.findFirst({
      where: { organizationId, configId, status: "completed" },
      orderBy: { finishedAt: "desc" },
    });

    const offlinePassRate =
      latestEval && latestEval.itemCount > 0
        ? latestEval.passCount / latestEval.itemCount
        : null;
    const judgeWinRate =
      latestEval &&
      latestEval.pairwiseWins != null &&
      latestEval.pairwiseLosses != null &&
      latestEval.pairwiseWins + latestEval.pairwiseLosses > 0
        ? latestEval.pairwiseWins /
          (latestEval.pairwiseWins + latestEval.pairwiseLosses)
        : null;

    await tx.outreachConfigScorecard.upsert({
      where: { configId },
      create: {
        configId,
        organizationId,
        delivered,
        sent,
        bounced,
        positiveReplies,
        engagedReplies,
        hardNoCount,
        unsubscribeCount,
        spamComplaintCount,
        potentialScoreSum,
        generationCount,
        acceptedCount,
        editDistanceSum,
        editDistanceCount,
        maturityPct,
        positiveReplyRate,
        engagedReplyRate,
        meanPotentialScore,
        acceptanceRate,
        meanEditDistance,
        bounceRate,
        unsubscribeRate,
        hardNoRate,
        spamComplaintRate,
        offlinePassRate,
        offlineHallucination: latestEval?.hallucinationCount ?? null,
        judgeWinRate,
        segments: {} as Prisma.InputJsonValue,
        posteriorAlpha: posterior.alpha,
        posteriorBeta: posterior.beta,
        confoundWarnings: confoundWarnings as unknown as Prisma.InputJsonValue,
        refreshedAt: new Date(),
      },
      update: {
        delivered,
        sent,
        bounced,
        positiveReplies,
        engagedReplies,
        hardNoCount,
        unsubscribeCount,
        spamComplaintCount,
        potentialScoreSum,
        generationCount,
        acceptedCount,
        editDistanceSum,
        editDistanceCount,
        maturityPct,
        positiveReplyRate,
        engagedReplyRate,
        meanPotentialScore,
        acceptanceRate,
        meanEditDistance,
        bounceRate,
        unsubscribeRate,
        hardNoRate,
        spamComplaintRate,
        offlinePassRate,
        offlineHallucination: latestEval?.hallucinationCount ?? null,
        judgeWinRate,
        posteriorAlpha: posterior.alpha,
        posteriorBeta: posterior.beta,
        confoundWarnings: confoundWarnings as unknown as Prisma.InputJsonValue,
        refreshedAt: new Date(),
      },
    });
  });
}

/** Refresh all configs that have recent activity (bypass for worker tick). */
export async function refreshAllOutreachScorecards(): Promise<{ refreshed: number }> {
  if (!isDatabaseConfigured()) return { refreshed: 0 };
  let refreshed = 0;
  await withRlsBypass(async (tx) => {
    const configs = await tx.outreachConfig.findMany({
      select: { id: true, organizationId: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    });
    for (const c of configs) {
      try {
        await refreshOutreachConfigScorecard({
          organizationId: c.organizationId,
          configId: c.id,
        });
        refreshed += 1;
      } catch (e) {
        console.warn("[scorecard] refresh failed", c.id, e);
      }
    }
  });
  return { refreshed };
}

export async function getOutreachConfigScorecard(organizationId: string, configId: string) {
  if (!isDatabaseConfigured()) return null;
  return withOrganizationScope(organizationId, async (tx) =>
    tx.outreachConfigScorecard.findFirst({ where: { configId, organizationId } }),
  );
}
