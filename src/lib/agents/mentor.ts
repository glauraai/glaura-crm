import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkUserAiBudget, runCachedHaikuJson } from "./llm";

export const MENTOR_RUBRIC_STEPS = [
  { step: 1, label: "Compte salon & démo préparés avant d’arriver", maxScore: 10 },
  { step: 2, label: "Créer du lien et observer le salon", maxScore: 10 },
  { step: 3, label: "Faire émerger le problème (questions ouvertes)", maxScore: 15 },
  { step: 4, label: "Valider explicitement un besoin prioritaire", maxScore: 15 },
  { step: 5, label: "Montrer la solution sur le compte démo", maxScore: 15 },
  { step: 6, label: "Faire prendre en main l’espace préparé", maxScore: 10 },
  { step: 7, label: "Relier le prix au besoin + site offert en annuel", maxScore: 15 },
  { step: 8, label: "Closer et fixer une prochaine étape concrète", maxScore: 10 },
] as const;

export const KNOWN_OBJECTIONS = [
  {
    category: "PAS_BESOIN_NOUVEAUX_CLIENTS",
    label: "« Je n’ai pas besoin de nouveaux clients. »",
    referenceResponse:
      "On a toujours besoin de nouvelles clientes (certaines déménagent ou arrêtent) ; le site personnalisé offert en annuel fait souvent changer d’avis.",
  },
  {
    category: "DEJA_PLANITY_ACOMPTE_SMS",
    label: "« J’ai déjà l’acompte et les rappels SMS avec Planity. »",
    referenceResponse:
      "Ne pas se battre sur les rendez-vous non honorés ; passer à la fidélisation et aux relances WhatsApp automatiques.",
  },
  {
    category: "DEJA_PROMOS_PLANITY_TREATWELL",
    label: "« Je fais déjà mes promos sur Planity ou Treatwell. »",
    referenceResponse:
      "Planity oblige à baisser le prix, Treatwell impose une remise sur tout l’établissement ; Glaura cible une prestation, un créneau et un nombre de places, avec prix barré.",
  },
  {
    category: "COMMISSION",
    label: "« Vous prenez combien de commission ? »",
    referenceResponse:
      "Zéro sur ce qui vient du salon, 10 % une seule fois sur une nouvelle cliente apportée par l’application Glaura.",
  },
  {
    category: "PREPARATION_COMPTE",
    label: "« Comment avez-vous préparé mon compte ? »",
    referenceResponse: "Uniquement avec des informations publiques (Google, réseaux sociaux, page de réservation).",
  },
  {
    category: "RETICENCE_IA",
    label: "Réticence à l’IA",
    referenceResponse: "Présenter Laura comme un service rendu aux clientes, sans promettre de résultat.",
  },
] as const;

export const mentorEvaluationSchema = z.object({
  stepScores: z
    .array(
      z.object({
        step: z.number().int().min(1).max(8),
        label: z.string(),
        score: z.number().min(0).max(15),
        maxScore: z.number().min(5).max(15),
        note: z.string(),
      }),
    )
    .min(1),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  closingLevers: z.array(z.string()).default([]),
  salesAngleUsed: z.string().nullable().optional(),
  objections: z
    .array(
      z.object({
        category: z.string(),
        verbatim: z.string(),
        responseGiven: z.string().nullable().optional(),
        succeeded: z.boolean().nullable().optional(),
      }),
    )
    .default([]),
});

export type MentorEvaluationOutput = z.infer<typeof mentorEvaluationSchema>;

export function computeOverallMentorScore(
  stepScores: ReadonlyArray<{ score: number; maxScore: number }>,
): number {
  const maxTotal = stepScores.reduce((s, x) => s + Math.max(0, x.maxScore), 0);
  if (maxTotal <= 0) return 0;
  const rawTotal = stepScores.reduce((s, x) => s + Math.max(0, Math.min(x.maxScore, x.score)), 0);
  return Math.round((rawTotal / maxTotal) * 100);
}

export function buildDeterministicMentorEvaluation(transcriptText: string): MentorEvaluationOutput {
  const lower = transcriptText.toLowerCase();
  const hasDemo = /démo|compte préparé|page salon|aperçu/.test(lower);
  const hasQuestion = transcriptText.includes("?");
  const hasPrice = /€|euro|annuel|mensuel|tarif|prix|site/.test(lower);
  const hasNextStep = /prochaine étape|rappel|mardi|mercredi|jeudi|vendredi|lundi|devis|lien|rdv/.test(lower);

  const stepScores = MENTOR_RUBRIC_STEPS.map((s) => {
    let ratio = 0.5;
    let note = "Partiellement observé dans la transcription.";
    if (s.step === 1 || s.step === 5 || s.step === 6) {
      ratio = hasDemo ? 0.8 : 0.3;
      note = hasDemo ? "Référence à la démo / espace préparé détectée." : "Peu ou pas de mention du compte démo.";
    } else if (s.step === 3 || s.step === 4) {
      ratio = hasQuestion ? 0.75 : 0.4;
      note = hasQuestion ? "Questions de découverte repérées." : "Ajouter davantage de questions ouvertes.";
    } else if (s.step === 7) {
      ratio = hasPrice ? 0.8 : 0.4;
      note = hasPrice ? "Tarif / valeur annuel abordés." : "Relier explicitement le prix au besoin validé.";
    } else if (s.step === 8) {
      ratio = hasNextStep ? 0.85 : 0.3;
      note = hasNextStep ? "Prochaine étape concrète identifiée." : "Fixer une date et une prochaine étape précise.";
    }
    return { step: s.step, label: s.label, score: Math.round(s.maxScore * ratio), maxScore: s.maxScore, note };
  });

  const objections: MentorEvaluationOutput["objections"] = [];
  if (/commission|pourcentage/.test(lower)) {
    objections.push({ category: "COMMISSION", verbatim: "Question sur la commission mentionnée", responseGiven: null, succeeded: null });
  }
  if (/planity|treatwell/.test(lower)) {
    objections.push({ category: "DEJA_PLANITY_ACOMPTE_SMS", verbatim: "Outil concurrent (Planity / Treatwell) évoqué", responseGiven: null, succeeded: null });
  }
  if (/ia|robot|automatique/.test(lower)) {
    objections.push({ category: "RETICENCE_IA", verbatim: "Sujet IA / automatisation discuté", responseGiven: null, succeeded: null });
  }

  return {
    stepScores,
    strengths: hasNextStep ? ["Prochaine étape posée en fin d’échange"] : ["Échange engagé avec le salon"],
    improvements: !hasDemo ? ["Montrer l’espace démo préparé pendant l’échange"] : ["Valider explicitement le besoin prioritaire avant le tarif"],
    closingLevers: [
      ...(hasDemo ? ["Démonstration sur le compte préparé"] : []),
      ...(hasPrice && /site|annuel/.test(lower) ? ["Site personnalisé offert en annuel"] : []),
      ...(hasNextStep ? ["Prochaine étape datée"] : []),
    ],
    salesAngleUsed: null,
    objections,
  };
}

const MENTOR_SYSTEM_PROMPT = `Tu es MENTOR, l'agent IA de coaching commercial de Glaura.
Tu évalues un appel ou un rendez-vous face aux 8 étapes du déroulé Glaura :
1. Compte salon & démo préparés avant d'arriver (/10)
2. Créer du lien et observer le salon (/10)
3. Faire émerger le problème par questions ouvertes (/15)
4. Valider explicitement un besoin prioritaire (/15)
5. Montrer la solution sur le compte démo (/15)
6. Faire prendre en main l'espace préparé (/10)
7. Relier le prix au besoin + site offert en annuel (/15)
8. Closer et fixer une prochaine étape concrète (/10)

Catégories d'objections connues : PAS_BESOIN_NOUVEAUX_CLIENTS, DEJA_PLANITY_ACOMPTE_SMS, DEJA_PROMOS_PLANITY_TREATWELL, COMMISSION, PREPARATION_COMPTE, RETICENCE_IA, AUTRE.
Réponds UNIQUEMENT en JSON valide : { stepScores: [{step,label,score,maxScore,note}], strengths: string[], improvements: string[], closingLevers: string[], salesAngleUsed: string|null, objections: [{category,verbatim,responseGiven,succeeded}] }.`;

export async function evaluateTranscriptWithMentor(transcriptId: string) {
  const record = await prisma.transcriptRecord.findUnique({
    where: { id: transcriptId },
    include: {
      salon: { select: { id: true, name: true, assignedToId: true } },
      opportunity: { select: { id: true, stage: true, ownerId: true } },
    },
  });
  if (!record || !record.salonId || record.mentorProcessedAt) return { skipped: true };

  const text = record.rawTranscript?.trim() || record.summary?.trim() || "";
  if (!text) return { empty: true };

  const repId = record.userId ?? record.opportunity?.ownerId ?? record.salon?.assignedToId;
  let evaluation = buildDeterministicMentorEvaluation(text);

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const budget = await checkUserAiBudget(repId);
    if (budget.allowed) {
      try {
        const llm = await runCachedHaikuJson({
          systemPrompt: MENTOR_SYSTEM_PROMPT,
          userPayload: {
            salonName: record.salon?.name ?? "Salon",
            stage: record.opportunity?.stage ?? "R1_EFFECTUE",
            durationSec: record.durationSec,
            transcript: text.slice(0, 20_000),
          },
          parse: (raw) => mentorEvaluationSchema.parse(raw),
          maxTokens: 1000,
        });
        evaluation = llm.output;
      } catch (err) {
        console.error("[MENTOR] LLM fallback used:", err);
      }
    }
  }

  const overallScore = computeOverallMentorScore(evaluation.stepScores);

  await prisma.$transaction(async (tx) => {
    await tx.callEvaluation.upsert({
      where: { transcriptId: record.id },
      create: {
        transcriptId: record.id,
        salonId: record.salonId,
        opportunityId: record.opportunityId,
        userId: repId,
        overallScore,
        stepScoresJson: evaluation.stepScores as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
        closingLevers: evaluation.closingLevers,
        salesAngleUsed: evaluation.salesAngleUsed ?? null,
      },
      update: {
        overallScore,
        stepScoresJson: evaluation.stepScores as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
        closingLevers: evaluation.closingLevers,
        salesAngleUsed: evaluation.salesAngleUsed ?? null,
      },
    });

    if (evaluation.objections.length > 0) {
      await tx.objectionRecord.createMany({
        data: evaluation.objections.map((o) => ({
          transcriptId: record.id,
          salonId: record.salonId,
          opportunityId: record.opportunityId,
          userId: repId,
          category: o.category,
          verbatim: o.verbatim,
          responseGiven: o.responseGiven ?? null,
          succeeded: o.succeeded ?? null,
        })),
      });
    }

    await tx.transcriptRecord.update({
      where: { id: record.id },
      data: { mentorProcessedAt: new Date() },
    });
  });

  return { ok: true, overallScore, objectionsCount: evaluation.objections.length };
}

// ── Pure Analytics Aggregators for Pilotage Rows 6, 7 & 8 ───────────────────

export type ObjectionStatRow = {
  category: string;
  label: string;
  count: number;
  resolvedCount: number;
  successRatePct: number | null;
  topResponse: string | null;
};

export function computeObjectionStats(
  records: ReadonlyArray<{ category: string; responseGiven: string | null; succeeded: boolean | null }>,
): ObjectionStatRow[] {
  const map = new Map<string, { count: number; judged: number; resolved: number; responses: string[] }>();
  for (const r of records) {
    const prev = map.get(r.category) ?? { count: 0, judged: 0, resolved: 0, responses: [] };
    prev.count++;
    if (r.succeeded !== null) {
      prev.judged++;
      if (r.succeeded) prev.resolved++;
    }
    if (r.responseGiven?.trim()) prev.responses.push(r.responseGiven.trim());
    map.set(r.category, prev);
  }

  return Array.from(map.entries())
    .map(([category, agg]) => {
      const known = KNOWN_OBJECTIONS.find((k) => k.category === category);
      return {
        category,
        label: known?.label ?? category,
        count: agg.count,
        resolvedCount: agg.resolved,
        successRatePct: agg.judged > 0 ? Math.round((agg.resolved / agg.judged) * 100) : null,
        topResponse: agg.responses[0] ?? known?.referenceResponse ?? null,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export type ClosingLeverRow = {
  lever: string;
  wonRatePct: number;
  lostRatePct: number;
  liftPct: number;
  wonCount: number;
  lostCount: number;
};

export function computeClosingLevers(
  rows: ReadonlyArray<{ outcome: "WON" | "LOST"; closingLevers: string[] }>,
): ClosingLeverRow[] {
  const wonTotal = rows.filter((r) => r.outcome === "WON").length;
  const lostTotal = rows.filter((r) => r.outcome === "LOST").length;
  const counts = new Map<string, { won: number; lost: number }>();

  for (const row of rows) {
    const unique = new Set(row.closingLevers.map((l) => l.trim()).filter(Boolean));
    for (const lever of unique) {
      const prev = counts.get(lever) ?? { won: 0, lost: 0 };
      if (row.outcome === "WON") prev.won++;
      else prev.lost++;
      counts.set(lever, prev);
    }
  }

  return Array.from(counts.entries())
    .map(([lever, c]) => {
      const wonRatePct = wonTotal > 0 ? Math.round((c.won / wonTotal) * 100) : 0;
      const lostRatePct = lostTotal > 0 ? Math.round((c.lost / lostTotal) * 100) : 0;
      return {
        lever,
        wonRatePct,
        lostRatePct,
        liftPct: wonRatePct - lostRatePct,
        wonCount: c.won,
        lostCount: c.lost,
      };
    })
    .sort((a, b) => b.liftPct - a.liftPct || b.wonCount - a.wonCount);
}

export type SegmentPerformanceRow = {
  segment: string;
  total: number;
  won: number;
  conversionPct: number;
  topAngle: string | null;
};

export function computeClientSegmentation(
  deals: ReadonlyArray<{ segment: string; won: boolean; angle?: string | null }>,
): SegmentPerformanceRow[] {
  const map = new Map<string, { total: number; won: number; angleCounts: Map<string, number> }>();
  for (const d of deals) {
    const key = d.segment || "Non classé";
    const prev = map.get(key) ?? { total: 0, won: 0, angleCounts: new Map<string, number>() };
    prev.total++;
    if (d.won) {
      prev.won++;
      if (d.angle) prev.angleCounts.set(d.angle, (prev.angleCounts.get(d.angle) ?? 0) + 1);
    }
    map.set(key, prev);
  }

  return Array.from(map.entries())
    .map(([segment, agg]) => {
      let topAngle: string | null = null;
      let bestCount = 0;
      for (const [angle, count] of agg.angleCounts.entries()) {
        if (count > bestCount) {
          bestCount = count;
          topAngle = angle;
        }
      }
      return {
        segment,
        total: agg.total,
        won: agg.won,
        conversionPct: agg.total > 0 ? Math.round((agg.won / agg.total) * 100) : 0,
        topAngle,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Weekly MENTOR playbook update proposal for Fodé (creates PLAYBOOK_UPDATE AgentSuggestion).
 */
export async function runWeeklyPlaybookLearning(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const objections = await prisma.objectionRecord.findMany({
    where: { createdAt: { gte: since } },
    select: { category: true, responseGiven: true, succeeded: true },
  });
  if (objections.length < 3) return { skipped: true, reason: "Pas assez d’objections cette semaine." };

  const stats = computeObjectionStats(objections);
  const top = stats[0];
  const managers = await prisma.user.findMany({
    where: { active: true, role: { in: ["MANAGER", "ADMIN"] } },
    select: { id: true },
  });
  const assigneeId = managers[0]?.id ?? null;

  const existing = await prisma.agentSuggestion.findFirst({
    where: { agent: "MENTOR", kind: "PLAYBOOK_UPDATE", status: "PENDING", createdAt: { gte: since } },
    select: { id: true },
  });
  if (existing) return { skipped: true, reason: "Proposition hebdomadaire déjà en attente." };

  await prisma.agentSuggestion.create({
    data: {
      agent: "MENTOR",
      kind: "PLAYBOOK_UPDATE",
      targetType: "PLAYBOOK",
      assignedToId: assigneeId,
      title: `Mise à jour Playbook MENTOR · ${top.label}`,
      proposedPayload: {
        topCategory: top.category,
        objectionsObserved: top.count,
        successRatePct: top.successRatePct,
        recommendedAddition: top.topResponse,
        summary: `Objection la plus fréquente cette semaine (${top.count} occurrences) : ${top.label}.`,
      } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      generationReport: {
        actionsTaken: [`Agrégation de ${objections.length} objections des 7 derniers jours`],
        assumptions: ["Validation manager requise avant intégration au playbook"],
        toVerify: ["Relire les verbatims associés dans /pilotage"],
        sources: ["Transcriptions MENTOR / ECHO"],
      } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
    },
  });

  return { ok: true, topCategory: top.category };
}
