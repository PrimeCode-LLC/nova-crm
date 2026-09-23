export type DealStageSum = { sum: number; count: number };

/** Shape Prisma `deal.groupBy` stage rows into `{ [stage]: { sum, count } }`. */
export function mapDealStageGroupSums(
  rows: ReadonlyArray<{
    stage: string;
    _sum: { value: number | null };
    _count: { _all: number };
  }>,
): Record<string, DealStageSum> {
  const out: Record<string, DealStageSum> = {};
  for (const row of rows) {
    if (!row.stage) continue;
    const raw = row._sum.value;
    out[row.stage] = {
      sum: typeof raw === "number" && Number.isFinite(raw) ? raw : 0,
      count: row._count._all,
    };
  }
  return out;
}

/** `sumValue=1` cannot share a request with a list page or a full snapshot walk. */
export function dealSumValueConflictsWithList(opts: {
  all: boolean;
  cursor: string | null;
  limitSpecified: boolean;
}): boolean {
  return opts.all || Boolean(opts.cursor?.trim()) || opts.limitSpecified;
}

export type OpenWonDealMoney = {
  openSum: number;
  openCount: number;
  wonSum: number;
  wonCount: number;
};

/** Collapse stage group-bys into the account KPIs: open = not won/lost, won = won. */
export function openWonDealMoneyFromStageSums(
  sums: Record<string, DealStageSum> | null | undefined,
): OpenWonDealMoney | null {
  if (!sums) return null;
  let openSum = 0;
  let openCount = 0;
  let wonSum = 0;
  let wonCount = 0;
  for (const [stage, row] of Object.entries(sums)) {
    const sum = typeof row?.sum === "number" && Number.isFinite(row.sum) ? row.sum : 0;
    const count = typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : 0;
    if (stage === "won") {
      wonSum += sum;
      wonCount += count;
    } else if (stage !== "lost") {
      openSum += sum;
      openCount += count;
    }
  }
  return { openSum, openCount, wonSum, wonCount };
}
