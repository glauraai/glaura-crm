export const DEFAULT_AI_MONTHLY_BUDGET_EUR = 10;

const USD_TO_EUR = 0.95;

type ModelRatesUsdPerM = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const MODEL_RATES: Record<string, ModelRatesUsdPerM> = {
  "claude-haiku-5-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
};

export type AiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function configuredMonthlyBudgetEur(): number {
  const raw = Number(process.env.CRM_AI_MONTHLY_BUDGET_EUR);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AI_MONTHLY_BUDGET_EUR;
}

export function configuredMonthlyRunLimit(): number | null {
  const raw = Number(process.env.CRM_AI_MONTHLY_RUN_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

export function estimateAnthropicCostEur(model: string, usage: AiTokenUsage): number {
  const key = Object.keys(MODEL_RATES).find((k) => model.includes(k)) ?? "claude-haiku-5-5";
  const rates = MODEL_RATES[key];
  const usd =
    (Math.max(0, usage.inputTokens) * rates.input +
      Math.max(0, usage.outputTokens) * rates.output +
      Math.max(0, usage.cacheReadTokens ?? 0) * rates.cacheRead +
      Math.max(0, usage.cacheWriteTokens ?? 0) * rates.cacheWrite) /
    1_000_000;
  return Math.round(usd * USD_TO_EUR * 10000) / 10000;
}

export function extractUsageCostEur(generationReport: unknown): number {
  if (!generationReport || typeof generationReport !== "object") return 0;
  const usage = (generationReport as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return 0;
  const cost = (usage as Record<string, unknown>).costEur;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : 0;
}

export function isMonthlyAiBudgetExceeded(input: {
  spentEur: number;
  runsThisMonth: number;
  budgetEur?: number;
  maxRuns?: number | null;
}): { exceeded: boolean; reason?: string } {
  const budgetEur = input.budgetEur ?? DEFAULT_AI_MONTHLY_BUDGET_EUR;
  if (input.spentEur >= budgetEur) {
    return {
      exceeded: true,
      reason: `Plafond mensuel IA atteint (${input.spentEur.toFixed(2)} € / ${budgetEur.toFixed(2)} € ce mois-ci).`,
    };
  }
  if (input.maxRuns != null && input.runsThisMonth >= input.maxRuns) {
    return {
      exceeded: true,
      reason: `Plafond mensuel d’exécutions IA atteint (${input.runsThisMonth} / ${input.maxRuns}).`,
    };
  }
  return { exceeded: false };
}
