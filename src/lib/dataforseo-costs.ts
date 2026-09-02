import { Prisma, type Device, type SearchType } from "@prisma/client";
import { prisma } from "@/lib/db";

export const STANDARD_SERP_PAGE_COST_USD = 0.0006;
export const LIVE_SERP_PAGE_COST_USD = 0.002;
export const KEYWORD_METRICS_TASK_COST_USD = 0.06;

type CostSelection = {
  keywordCount: number;
  locationCount: number;
  devices: Device[];
  searchTypes: SearchType[];
  pageLimit: number;
};

export function estimateRankRunCost(selection: CostSelection, method: "live" | "standard") {
  const base = method === "live" ? LIVE_SERP_PAGE_COST_USD : STANDARD_SERP_PAGE_COST_USD;
  const combinations = selection.keywordCount * selection.locationCount * selection.devices.length;
  const unitsPerCombination = selection.searchTypes.reduce(
    (total, type) => total + (type === "organic" ? selection.pageLimit : 1),
    0
  );
  return roundUsd(combinations * unitsPerCombination * base);
}

export function configuredMonthlyBudgetUsd() {
  return positiveMoney(process.env.DATAFORSEO_MONTHLY_BUDGET_USD, 1);
}

export function configuredKeywordMetricsCostUsd() {
  return positiveMoney(process.env.DATAFORSEO_KEYWORD_METRICS_COST_USD, KEYWORD_METRICS_TASK_COST_USD);
}

export async function getDataForSeoBudgetSummary(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const start = startOfUtcMonth();
  const [actual, rankReservations, metricReservations] = await Promise.all([
    db.apiRequest.aggregate({
      where: {
        provider: "dataforseo",
        sandbox: false,
        createdAt: { gte: start },
        endpoint: { not: { contains: "/task_get/" } }
      },
      _sum: { costUsd: true }
    }),
    db.rankRun.findMany({
      where: { sandbox: false, status: { in: ["queued", "running"] } },
      select: { estimatedCostUsd: true, actualCostUsd: true }
    }),
    db.project.findMany({
      where: { keywordMetricsStatus: { in: ["queued", "submitting", "submitted"] } },
      select: { keywordMetricsEstimatedCostUsd: true, keywordMetricsActualCostUsd: true }
    })
  ]);

  const spentUsd = decimalNumber(actual._sum.costUsd);
  const reservedUsd = roundUsd(
    rankReservations.reduce(
      (total, run) => total + Math.max(0, decimalNumber(run.estimatedCostUsd) - decimalNumber(run.actualCostUsd)),
      0
    ) + metricReservations.reduce(
      (total, project) => total + Math.max(
        0,
        decimalNumber(project.keywordMetricsEstimatedCostUsd) - decimalNumber(project.keywordMetricsActualCostUsd)
      ),
      0
    )
  );
  const limitUsd = configuredMonthlyBudgetUsd();

  return {
    limitUsd,
    spentUsd: roundUsd(spentUsd),
    reservedUsd,
    availableUsd: roundUsd(Math.max(0, limitUsd - spentUsd - reservedUsd))
  };
}

export async function assertBudgetAvailable(
  estimatedCostUsd: number,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const budget = await getDataForSeoBudgetSummary(db);
  if (estimatedCostUsd > budget.availableUsd + 0.0000001) {
    throw new Error(
      `Monthly DataForSEO budget exceeded. $${estimatedCostUsd.toFixed(4)} requested, ` +
      `$${budget.availableUsd.toFixed(4)} available from the $${budget.limitUsd.toFixed(2)} limit.`
    );
  }
  return budget;
}

function startOfUtcMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function positiveMoney(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function decimalNumber(value: Prisma.Decimal | number | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
