import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { OPPORTUNITY_STAGE_ORDER } from "@/lib/pipeline/stages";
import { estimateAnthropicCostEur } from "./budget";

const stageEnum = z.enum(OPPORTUNITY_STAGE_ORDER as [string, ...string[]]);

export const echoOutputSchema = z.object({
  isDecisionMakerCall: z.boolean(),
  decisionMakerName: z.string().nullable().optional(),
  decisionMakerRole: z.string().nullable().optional(),
  qualification: z.object({
    salonSize: z.string().nullable().optional(),
    currentTool: z.string().nullable().optional(),
    mainPain: z.string().nullable().optional(),
    budget: z.string().nullable().optional(),
    salesAngle: z.string().nullable().optional(),
    productsPitched: z.array(z.string()).default([]),
  }),
  proposedStage: stageEnum.nullable().optional(),
  objections: z
    .array(
      z.object({
        category: z.string(),
        verbatim: z.string(),
        responseGiven: z.string().nullable().optional(),
      }),
    )
    .default([]),
  nextStep: z.string().nullable().optional(),
  nextStepDate: z.string().nullable().optional(),
  generationReport: z.object({
    actionsTaken: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
    toVerify: z.array(z.string()).default([]),
    sources: z.array(z.string()).default([]),
  }),
});

export type EchoOutput = z.infer<typeof echoOutputSchema>;

export function parseEchoOutput(raw: unknown): EchoOutput {
  return echoOutputSchema.parse(raw);
}

export type SuggestionDiffEntry = {
  field: string;
  before: unknown;
  after: unknown;
};

export function computeSuggestionDiff(
  proposed: Record<string, unknown>,
  applied: Record<string, unknown> | null | undefined,
): SuggestionDiffEntry[] {
  if (!applied) return [];
  const keys = new Set([...Object.keys(proposed), ...Object.keys(applied)]);
  const diffs: SuggestionDiffEntry[] = [];
  for (const field of keys) {
    const before = proposed[field];
    const after = applied[field];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push({ field, before, after });
    }
  }
  return diffs;
}

const ECHO_SYSTEM_PROMPT = `Tu es ECHO, l'agent IA de mémoire et saisie commerciale de Glaura (plateforme de réservation et Laura IA pour salons de beauté en France).
Règles strictes :
- Tu analyses une transcription ou un résumé d'appel/réunion et tu PROPOSES une saisie structurée (jamais écrite sans validation humaine).
- Tu utilises uniquement les informations présentes dans l'échange : n'invente jamais un budget, un nom ou une date.
- Qualifie "isDecisionMakerCall" à true uniquement si l'interlocuteur est clairement le/la gérant(e), fondateur/rice ou décideur/se et qu'une vraie conversation commerciale a eu lieu.
- Les 6 angles de vente Glaura sont : "Acquisition et conversion", "Fidélisation et marketing", "Messages et appels hors horaires (Laura IA)", "Synchronisation d'agenda", "Réservation depuis les vidéos", "Gestion et pilotage".
- Les stades valides sont : A_CONTACTER, CONTACTE, R1_PROGRAMME, R1_EFFECTUE, NO_SHOW, A_RELANCER, ANNULE, DEVIS_ENVOYE, ABONNE, COMPTE_ACTIVE, SIGNE, ENCAISSE, PERDU.
- Inclus toujours un generationReport honnête (actionsTaken, assumptions, toVerify, sources).
- Réponds UNIQUEMENT en JSON valide correspondant au schéma demandé.`;

export type EchoRunResult = {
  output: EchoOutput;
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costEur: number;
  };
};

export async function runEchoExtraction(input: {
  salonName: string;
  currentStage: string;
  sourceLabel: string;
  durationSec: number | null;
  transcriptText: string;
}): Promise<EchoRunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY manquante pour ECHO.");
  }
  const model = process.env.CRM_SALES_AGENT_MODEL?.trim() || "claude-haiku-5-5";
  const client = new Anthropic({ apiKey });

  const userPrompt = JSON.stringify({
    salonName: input.salonName,
    currentStage: input.currentStage,
    source: input.sourceLabel,
    durationSec: input.durationSec,
    transcript: input.transcriptText.slice(0, 24_000),
  });

  const msg = await client.messages.create({
    model,
    max_tokens: 1200,
    system: [{ type: "text", text: ECHO_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = msg.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Réponse ECHO vide.");
  }

  const cleaned = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

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
    output: parseEchoOutput(JSON.parse(cleaned)),
    usage: { model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costEur },
  };
}

export function twelveMonthsAgo(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}
