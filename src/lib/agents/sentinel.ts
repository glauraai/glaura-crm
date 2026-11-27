import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkUserAiBudget, runCachedHaikuJson } from "./llm";
import type { OpportunityStage } from "@/generated/prisma/enums";

export type SentinelSignalCode =
  | "NO_NEXT_STEP_7D"
  | "NO_SHOW_24H"
  | "QUOTE_NO_REPLY_5D"
  | "NOT_ACTIVATED_7D"
  | "SIGNED_UNPAID"
  | "NON_DECISION_MAKER_ONLY";

export type SentinelSignal = {
  code: SentinelSignalCode;
  severity: "HIGH" | "MEDIUM";
  reason: string;
  suggestedFollowUp: string;
};

export type DealRiskInput = {
  stage: OpportunityStage;
  salonName: string;
  updatedAt: Date;
  lastActivityAt: Date | null;
  nextStepAt: Date | null;
  signedAt: Date | null;
  salonActivatedAt: Date | null;
  paidInvoicesCount: number;
  hasPaymentIssue: boolean;
  contactCount: number;
  hasDecisionMakerContact: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STAGES: ReadonlySet<OpportunityStage> = new Set(["ENCAISSE", "PERDU"]);

export function evaluateDealRiskSignals(input: DealRiskInput, now = new Date()): SentinelSignal[] {
  if (CLOSED_STAGES.has(input.stage)) return [];
  const signals: SentinelSignal[] = [];
  const lastTouch = input.lastActivityAt && input.lastActivityAt > input.updatedAt ? input.lastActivityAt : input.updatedAt;
  const daysSinceTouch = Math.floor(Math.max(0, now.getTime() - lastTouch.getTime()) / DAY_MS);
  const hoursSinceTouch = Math.floor(Math.max(0, now.getTime() - lastTouch.getTime()) / (60 * 60 * 1000));

  // 1. No-show without follow-up > 24h
  if (input.stage === "NO_SHOW" && hoursSinceTouch >= 24) {
    signals.push({
      code: "NO_SHOW_24H",
      severity: "HIGH",
      reason: `No show non relancé depuis ${hoursSinceTouch} h`,
      suggestedFollowUp: `Appeler ${input.salonName} et proposer un nouveau créneau rapide de 15 min (avec rappel SMS/WhatsApp).`,
    });
  }

  // 2. Quote sent without reply > 5 days
  if (input.stage === "DEVIS_ENVOYE" && daysSinceTouch >= 5) {
    signals.push({
      code: "QUOTE_NO_REPLY_5D",
      severity: "HIGH",
      reason: `Devis envoyé sans réponse depuis ${daysSinceTouch} jours`,
      suggestedFollowUp: `Relancer ${input.salonName} sur le devis envoyé : vérifier le point bloquant et rappeler l’avantage annuel (site offert).`,
    });
  }

  // 3. Signed / subscribed without activation > 7 days
  if ((input.stage === "SIGNE" || input.stage === "ABONNE") && !input.salonActivatedAt) {
    const refDate = input.signedAt ?? input.updatedAt;
    const daysSinceSigned = Math.floor(Math.max(0, now.getTime() - refDate.getTime()) / DAY_MS);
    if (daysSinceSigned >= 7) {
      signals.push({
        code: "NOT_ACTIVATED_7D",
        severity: "HIGH",
        reason: `Abonné / signé sans activation du compte après ${daysSinceSigned} jours`,
        suggestedFollowUp: `Contacter ${input.salonName} pour finaliser l’activation du compte et planifier la prise en main.`,
      });
    }
  }

  // 4. Signed unpaid or payment issue
  if ((input.stage === "SIGNE" || input.stage === "COMPTE_ACTIVE" || input.stage === "ABONNE") && input.hasPaymentIssue) {
    signals.push({
      code: "SIGNED_UNPAID",
      severity: "HIGH",
      reason: "Paiement échoué, remboursement ou litige détecté dans Stripe",
      suggestedFollowUp: `Vérifier la facturation Stripe de ${input.salonName} et renvoyer un lien de régularisation.`,
    });
  } else if (input.stage === "SIGNE" && input.paidInvoicesCount === 0 && input.signedAt) {
    const daysSinceSigned = Math.floor(Math.max(0, now.getTime() - input.signedAt.getTime()) / DAY_MS);
    if (daysSinceSigned >= 10) {
      signals.push({
        code: "SIGNED_UNPAID",
        severity: "HIGH",
        reason: `Signé depuis ${daysSinceSigned} jours sans encaissement Stripe`,
        suggestedFollowUp: `Relancer ${input.salonName} sur le lien de paiement Stripe afin de déclencher l’abonnement.`,
      });
    }
  }

  // 5. No next step planned for > 7 days
  const hasFutureStep = input.nextStepAt != null && input.nextStepAt.getTime() > now.getTime();
  if (input.stage !== "A_CONTACTER" && !hasFutureStep && daysSinceTouch >= 7 && signals.length === 0) {
    signals.push({
      code: "NO_NEXT_STEP_7D",
      severity: "MEDIUM",
      reason: `Aucune prochaine étape planifiée depuis ${daysSinceTouch} jours`,
      suggestedFollowUp: `Planifier une relance téléphonique ou WhatsApp avec ${input.salonName} et fixer une date précise.`,
    });
  }

  // 6. Single non-decision-maker contact in late discovery / quote stage
  if (
    (input.stage === "R1_EFFECTUE" || input.stage === "DEVIS_ENVOYE") &&
    input.contactCount > 0 &&
    !input.hasDecisionMakerContact
  ) {
    signals.push({
      code: "NON_DECISION_MAKER_ONLY",
      severity: "MEDIUM",
      reason: "Interlocuteur unique non identifié comme décideur",
      suggestedFollowUp: `Obtenir un point direct de 10 min avec le/la gérant(e) de ${input.salonName} avant d’envoyer ou relancer le devis.`,
    });
  }

  return signals;
}

const sentinelRelanceSchema = z.object({
  followUpMessage: z.string().min(10),
  channel: z.enum(["APPEL", "EMAIL", "WHATSAPP", "INSTAGRAM"]).default("APPEL"),
  taskTitle: z.string().min(5),
  toVerify: z.array(z.string()).default([]),
});

const SENTINEL_SYSTEM_PROMPT = `Tu es SENTINEL, l'agent de vigilance pipeline de Glaura (plateforme de réservation et Laura IA pour salons de beauté en France).
Règles :
- Tu rédiges une relance courte, naturelle, en français ("vous"), adaptée au signal de risque détecté sur le deal.
- Tu ne promets jamais de remise non autorisée.
- Réponds UNIQUEMENT en JSON valide : { "followUpMessage": string, "channel": "APPEL"|"EMAIL"|"WHATSAPP"|"INSTAGRAM", "taskTitle": string, "toVerify": string[] }.`;

export async function runSentinelSweep(now = new Date()) {
  const opportunities = await prisma.opportunity.findMany({
    where: {
      stage: { notIn: ["ENCAISSE", "PERDU"] },
      salon: { archivedAt: null },
    },
    include: {
      salon: {
        select: {
          id: true,
          name: true,
          assignedToId: true,
          activatedAt: true,
          contacts: { select: { isDecisionMaker: true } },
          syncedInvoices: { select: { status: true, refunded: true, disputed: true } },
        },
      },
      activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      suggestions: {
        where: { agent: "SENTINEL", kind: "RELANCE", status: "PENDING" },
        select: { id: true },
      },
    },
  });

  let flagged = 0;
  let cleared = 0;
  let suggestionsCreated = 0;
  let llmCallsUsed = 0;
  const MAX_LLM_CALLS_PER_SWEEP = 20;

  for (const opp of opportunities) {
    const paidInvoicesCount = opp.salon.syncedInvoices.filter(
      (i) => i.status === "paid" && !i.refunded && !i.disputed,
    ).length;
    const hasPaymentIssue = opp.salon.syncedInvoices.some(
      (i) => i.refunded || i.disputed || i.status === "uncollectible",
    );

    const signals = evaluateDealRiskSignals(
      {
        stage: opp.stage,
        salonName: opp.salon.name,
        updatedAt: opp.updatedAt,
        lastActivityAt: opp.activities[0]?.createdAt ?? null,
        nextStepAt: opp.nextStepAt,
        signedAt: opp.signedAt,
        salonActivatedAt: opp.salon.activatedAt,
        paidInvoicesCount,
        hasPaymentIssue,
        contactCount: opp.salon.contacts.length,
        hasDecisionMakerContact: opp.salon.contacts.some((c) => c.isDecisionMaker),
      },
      now,
    );

    if (signals.length === 0) {
      if (opp.atRisk) {
        await prisma.opportunity.update({
          where: { id: opp.id },
          data: { atRisk: false, riskReason: null, riskHandledStatus: "RESOLVED" },
        });
        cleared++;
      }
      continue;
    }

    const topSignal = signals[0];
    const combinedReason = signals.map((s) => s.reason).join(" · ");
    flagged++;

    await prisma.opportunity.update({
      where: { id: opp.id },
      data: {
        atRisk: true,
        riskReason: combinedReason.slice(0, 500),
        riskFlaggedAt: opp.riskFlaggedAt ?? now,
        riskHandledStatus: opp.suggestions.length > 0 ? "RELANCE_PROPOSED" : "OPEN",
      },
    });

    // Avoid spamming duplicate pending SENTINEL relances
    if (opp.suggestions.length > 0) continue;

    const assigneeId = opp.ownerId ?? opp.salon.assignedToId;
    let followUpMessage = topSignal.suggestedFollowUp;
    let channel: "APPEL" | "EMAIL" | "WHATSAPP" | "INSTAGRAM" = "APPEL";
    let taskTitle = `Relance SENTINEL · ${opp.salon.name}`;
    let toVerify: string[] = ["Vérifier s’il y a eu un échange hors CRM avant de relancer."];
    let usage: unknown = undefined;

    if (process.env.ANTHROPIC_API_KEY?.trim() && llmCallsUsed < MAX_LLM_CALLS_PER_SWEEP) {
      const budget = await checkUserAiBudget(assigneeId);
      if (budget.allowed) {
        llmCallsUsed++;
        try {
          const llm = await runCachedHaikuJson({
            systemPrompt: SENTINEL_SYSTEM_PROMPT,
            userPayload: {
              salonName: opp.salon.name,
              stage: opp.stage,
              signals: signals.map((s) => ({ code: s.code, reason: s.reason })),
              monthlyAmountEur: opp.monthlyAmountEur,
            },
            parse: (raw) => sentinelRelanceSchema.parse(raw),
            maxTokens: 1600,
          });
          followUpMessage = llm.output.followUpMessage;
          channel = llm.output.channel;
          taskTitle = llm.output.taskTitle;
          if (llm.output.toVerify.length) toVerify = llm.output.toVerify;
          usage = llm.usage;
        } catch (err) {
          console.error("[SENTINEL] LLM fallback used:", err);
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.agentSuggestion.create({
        data: {
          agent: "SENTINEL",
          kind: "RELANCE",
          targetType: "OPPORTUNITY",
          targetId: opp.id,
          salonId: opp.salonId,
          opportunityId: opp.id,
          assignedToId: assigneeId,
          title: `Relance à risque · ${opp.salon.name}`,
          proposedPayload: {
            signalCode: topSignal.code,
            signals: signals.map((s) => s.reason),
            channel,
            followUpMessage,
            taskTitle,
            nextStep: taskTitle,
          } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
          generationReport: {
            actionsTaken: [`Détection signal SENTINEL (${topSignal.code})`, "Proposition de relance contextualisée"],
            assumptions: ["Aucune interaction récente enregistrée sur l’opportunité"],
            toVerify,
            sources: ["Pipeline CRM", "Activités", "Facturation Stripe"],
            ...(usage ? { usage } : {}),
          } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });
      await tx.opportunity.update({
        where: { id: opp.id },
        data: { riskHandledStatus: "RELANCE_PROPOSED" },
      });
    });
    suggestionsCreated++;
  }

  return { scanned: opportunities.length, flagged, cleared, suggestionsCreated };
}

export function isParisMondayMorning(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  return weekday === "Mon" && hour >= 7 && hour <= 10;
}

/**
 * Generates Fodé's Monday morning pipeline & risk digest task (idempotent per week).
 */
export async function ensureMondaySentinelDigest(now = new Date()) {
  if (!isParisMondayMorning(now)) return { skipped: true };
  const weekKey = `${now.getUTCFullYear()}-W${String(Math.ceil((now.getUTCDate() + 6) / 7)).padStart(2, "0")}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const managers = await prisma.user.findMany({
    where: { active: true, role: { in: ["MANAGER", "ADMIN"] } },
    select: { id: true },
  });
  if (managers.length === 0) return { skipped: true };

  const [atRiskCount, openCount, pendingSuggestions] = await Promise.all([
    prisma.opportunity.count({ where: { atRisk: true, stage: { notIn: ["ENCAISSE", "PERDU"] } } }),
    prisma.opportunity.count({ where: { stage: { notIn: ["ENCAISSE", "PERDU"] } } }),
    prisma.agentSuggestion.count({ where: { status: "PENDING" } }),
  ]);

  let created = 0;
  for (const m of managers) {
    await prisma.salesTask.upsert({
      where: { requestKey: `sentinel-monday:${m.id}:${weekKey}` },
      create: {
        requestKey: `sentinel-monday:${m.id}:${weekKey}`,
        title: `Rapport hebdo SENTINEL : ${atRiskCount} deal(s) à risque / ${openCount} en cours`,
        context: `${atRiskCount} opportunité(s) signalée(s) à risque, ${pendingSuggestions} suggestion(s) IA en attente de validation. Consultez /pilotage pour le détail.`,
        assignedToId: m.id,
        dueAt: now,
      },
      update: {},
    });
    created++;
  }
  return { ok: true, created, atRiskCount };
}
