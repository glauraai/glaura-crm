import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { startOfCurrentParisMonth } from "@/lib/pipeline/stages";
import {
  configuredMonthlyBudgetEur,
  configuredMonthlyRunLimit,
  estimateAnthropicCostEur,
  extractUsageCostEur,
  isMonthlyAiBudgetExceeded,
} from "./budget";

export const DEFAULT_SALES_AGENT_MODEL = "claude-haiku-5-5";

export type LlmUsageReport = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costEur: number;
};

export function configuredSalesAgentModel(): string {
  return process.env.CRM_SALES_AGENT_MODEL?.trim() || DEFAULT_SALES_AGENT_MODEL;
}

export function stripJsonCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

export async function checkUserAiBudget(userId: string | null | undefined): Promise<{
  allowed: boolean;
  spentEur: number;
  budgetEur: number;
  reason?: string;
}> {
  const budgetEur = configuredMonthlyBudgetEur();
  if (!userId) return { allowed: true, spentEur: 0, budgetEur };
  const monthStart = startOfCurrentParisMonth();
  const monthlySuggestions = await prisma.agentSuggestion.findMany({
    where: { assignedToId: userId, createdAt: { gte: monthStart } },
    select: { generationReport: true },
  });
  const spentEur = monthlySuggestions.reduce((sum, s) => sum + extractUsageCostEur(s.generationReport), 0);
  const check = isMonthlyAiBudgetExceeded({
    spentEur,
    runsThisMonth: monthlySuggestions.length,
    budgetEur,
    maxRuns: configuredMonthlyRunLimit(),
  });
  return { allowed: !check.exceeded, spentEur, budgetEur, reason: check.reason };
}

export async function runCachedHaikuText(input: {
  systemPrompt: string;
  userContent: string;
  maxTokens?: number;
}): Promise<{ text: string; usage: LlmUsageReport }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY manquante.");
  }
  const model = configuredSalesAgentModel();
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model,
    max_tokens: input.maxTokens ?? 1200,
    system: [{ type: "text", text: input.systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: input.userContent }],
  });

  const textBlock = msg.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Réponse IA vide.");
  }

  const rawUsage = msg.usage as unknown as Record<string, number | undefined>;
  const inputTokens = rawUsage.input_tokens ?? 0;
  const outputTokens = rawUsage.output_tokens ?? 0;
  const cacheReadTokens = rawUsage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = rawUsage.cache_creation_input_tokens ?? 0;
  const costEur = estimateAnthropicCostEur(model, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });

  return {
    text: textBlock.text.trim(),
    usage: { model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costEur },
  };
}

export async function runCachedHaikuJson<T>(input: {
  systemPrompt: string;
  userPayload: unknown;
  parse: (raw: unknown) => T;
  maxTokens?: number;
}): Promise<{ output: T; usage: LlmUsageReport }> {
  const { text, usage } = await runCachedHaikuText({
    systemPrompt: input.systemPrompt,
    userContent: typeof input.userPayload === "string" ? input.userPayload : JSON.stringify(input.userPayload),
    maxTokens: input.maxTokens ?? 1200,
  });
  const parsed = JSON.parse(stripJsonCodeFences(text));
  return { output: input.parse(parsed), usage };
}
