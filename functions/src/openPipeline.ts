/**
 * Keep in sync with `src/lib/dashboard-summary.ts` pipeline gauge helpers (P0.8).
 */

export type PipelineLeadFields = {
  id: string;
  intakeKind?: string | null;
  stage?: string | null;
  estimatedValue?: number | null;
};

export type PipelineDealFields = {
  leadId?: string | null;
  stage?: string | null;
  value?: number | null;
};

export function computeOrgOpenPipelineGauges(
  leads: readonly PipelineLeadFields[],
  deals: readonly PipelineDealFields[],
): {
  openPipelineValue: number;
  openDealCount: number;
  leadEstimateContributors: number;
} {
  const openDeals = deals.filter((d) => {
    const stage = typeof d.stage === "string" ? d.stage : "";
    return stage !== "won" && stage !== "lost";
  });
  const leadIdsWithOpenDeal = new Set(
    openDeals.map((d) => (typeof d.leadId === "string" ? d.leadId : "")).filter(Boolean),
  );
  const fromDeals = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  const salesLeads = leads.filter((l) => l.intakeKind !== "prospect");
  const openLeadsWithoutOpenDeal = salesLeads.filter((l) => {
    const stage = typeof l.stage === "string" ? l.stage : "";
    return stage !== "won" && stage !== "lost" && !leadIdsWithOpenDeal.has(l.id);
  });
  const fromLeadEstimates = openLeadsWithoutOpenDeal.reduce(
    (s, l) => s + (Number(l.estimatedValue) || 0),
    0,
  );
  const leadEstimateContributors = openLeadsWithoutOpenDeal.filter(
    (l) => (Number(l.estimatedValue) || 0) > 0,
  ).length;

  return {
    openPipelineValue: fromDeals + fromLeadEstimates,
    openDealCount: openDeals.length,
    leadEstimateContributors,
  };
}

export function computePipelineByStage(
  leads: readonly PipelineLeadFields[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    if (lead.intakeKind === "prospect") continue;
    const stage = typeof lead.stage === "string" && lead.stage ? lead.stage : "new";
    counts[stage] = (counts[stage] ?? 0) + 1;
  }
  return counts;
}

export function leadWriteAffectsPipelineByStage(
  before: PipelineLeadFields | null | undefined,
  after: PipelineLeadFields | null | undefined,
): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  return before.intakeKind !== after.intakeKind || before.stage !== after.stage;
}

export function leadWriteAffectsOpenPipeline(
  before: PipelineLeadFields | null | undefined,
  after: PipelineLeadFields | null | undefined,
): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  return (
    before.intakeKind !== after.intakeKind ||
    before.stage !== after.stage ||
    Number(before.estimatedValue ?? 0) !== Number(after.estimatedValue ?? 0)
  );
}

export function dealWriteAffectsOpenPipeline(
  before: PipelineDealFields | null | undefined,
  after: PipelineDealFields | null | undefined,
): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  return (
    before.stage !== after.stage ||
    Number(before.value ?? 0) !== Number(after.value ?? 0) ||
    before.leadId !== after.leadId
  );
}
