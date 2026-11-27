import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeThreeMonthAudienceGrowth, scoreAccountGtm1Bis } from "@/lib/gtm/scoring";
import { checkUserAiBudget, runCachedHaikuJson } from "./llm";

export const scoutBriefSchema = z.object({
  salonSummary: z.string(),
  historyRecap: z.string(),
  recommendedAngle: z.string(),
  probableObjections: z.array(z.string()).default([]),
  discoveryQuestions: z.array(z.string()).default([]),
  demoAccountReady: z.boolean(),
  demoReminder: z.string(),
  growthTalkingPoint: z.string().nullable().optional(),
  generationReport: z.object({
    actionsTaken: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
    toVerify: z.array(z.string()).default([]),
    sources: z.array(z.string()).default([]),
  }),
});

export type ScoutBrief = z.infer<typeof scoutBriefSchema>;

export function buildFallbackScoutBrief(input: {
  salonName: string;
  bookingTool: string;
  hasPlanity: boolean;
  hasTreatwell: boolean;
  instagram: string | null;
  instagramFollowers: number | null;
  recommendedAngle: string;
  demoAccountReady: boolean;
  growthPct: number | null;
  recentNotes: string[];
}): ScoutBrief {
  const dual = input.hasPlanity && input.hasTreatwell;
  const probableObjections = dual
    ? [
        "« J’ai déjà Planity et Treatwell, changer va être compliqué » → mettre en avant la synchronisation à 19 €/mois sans tout casser.",
        "« Vous prenez combien de commission ? » → 0 % sur votre clientèle, 10 % une seule fois sur une nouvelle cliente apportée par Glaura.",
      ]
    : [
        "« J’ai déjà l’acompte et les rappels SMS avec Planity » → ne pas se battre sur les no-shows, basculer sur la fidélisation et les relances WhatsApp.",
        "« Je n’ai pas besoin de nouveaux clients » → renouvellement naturel des clientes + site personnalisé offert en annuel.",
      ];

  const discoveryQuestions = [
    "Comment vos clientes actuelles prennent-elles rendez-vous aujourd’hui quand elles découvrent vos réalisations sur Instagram ?",
    "Combien de messages ou d’appels manquez-vous le soir ou pendant que vous êtes en prestation ?",
    "Comment faites-vous revenir une cliente qui n’a pas repris rendez-vous depuis 6 à 8 semaines ?",
  ];

  const growthTalkingPoint =
    input.growthPct != null && input.growthPct > 0
      ? `Votre audience a progressé de +${input.growthPct}% sur 3 mois : « vous avez gagné des abonnés, combien ont réservé ? »`
      : null;

  return {
    salonSummary: `${input.salonName} · Outil : ${dual ? "Planity + Treatwell" : input.bookingTool}${input.instagram ? ` · @${input.instagram}${input.instagramFollowers ? ` (${input.instagramFollowers.toLocaleString("fr-FR")} abonnés)` : ""}` : ""}.`,
    historyRecap:
      input.recentNotes.length > 0
        ? input.recentNotes.slice(0, 3).join(" | ")
        : "Aucun échange précédent enregistré dans le CRM.",
    recommendedAngle: input.recommendedAngle,
    probableObjections,
    discoveryQuestions,
    demoAccountReady: input.demoAccountReady,
    demoReminder: input.demoAccountReady
      ? "Compte démo déjà préparé : vérifiez le lien de la page salon avant le rendez-vous."
      : "Action requise avant le RDV : cliquez sur « Préparer le compte » sur la fiche salon pour générer l’espace démo.",
    growthTalkingPoint,
    generationReport: {
      actionsTaken: ["Synthèse de la fiche salon, signaux publics et historique CRM"],
      assumptions: ["Angle basé sur les critères GTM 1 bis disponibles"],
      toVerify: ["Confirmer le rôle de décideur en début d’échange", "Vérifier le nombre de praticiens exact"],
      sources: ["Fiche Salon CRM", "Signaux Prospection / SocialSnapshot"],
    },
  };
}

const SCOUT_SYSTEM_PROMPT = `Tu es SCOUT, l'agent IA de préparation des rendez-vous commerciaux de Glaura (salons de beauté en France).
Règles :
- Tu produis une fiche de préparation concise (1 page) en français avant un R1 ou une démo.
- Tu ne refais pas l'onboarding : tu vérifies "demoAccountReady" et tu rappelles au commercial de cliquer sur "Préparer le compte" si ce n'est pas encore fait.
- Choisis l'angle conseillé parmi les 6 angles Glaura : "Acquisition et conversion", "Fidélisation et marketing", "Messages et appels hors horaires (Laura IA)", "Synchronisation d'agenda", "Réservation depuis les vidéos", "Gestion et pilotage".
- Propose 2 à 3 objections probables et 3 questions ouvertes de découverte (sans interrogatoire).
- Réponds UNIQUEMENT en JSON valide correspondant au schéma { salonSummary, historyRecap, recommendedAngle, probableObjections, discoveryQuestions, demoAccountReady, demoReminder, growthTalkingPoint, generationReport: { actionsTaken, assumptions, toVerify, sources } }.`;

export async function generateScoutBriefForSalon(salonId: string, requestedById?: string | null) {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    include: {
      prospect: true,
      contacts: { orderBy: { isDecisionMaker: "desc" }, take: 5 },
      activities: { orderBy: { createdAt: "desc" }, take: 6, select: { type: true, notes: true, createdAt: true } },
      transcripts: { orderBy: { occurredAt: "desc" }, take: 3, select: { summary: true, occurredAt: true } },
      onboardingJobs: { orderBy: { createdAt: "desc" }, take: 3, select: { status: true } },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, stage: true, ownerId: true } },
      socialSnapshots: { orderBy: { monthKey: "asc" }, take: 6 },
    },
  });
  if (!salon) throw new Error("Salon introuvable.");

  const growth = computeThreeMonthAudienceGrowth(salon.socialSnapshots);
  const gtm = scoreAccountGtm1Bis({
    alreadyClient: salon.status === "SIGNE",
    isChainOrFranchise: salon.prospect?.aiOwnership === "chain_or_franchise",
    instagramHandle: salon.instagram,
    igStatus: salon.prospect?.igStatus ?? (salon.instagram ? "CONFIRME" : "A_FAIRE"),
    hasPlanity: salon.bookingTool === "PLANITY" || Boolean(salon.prospect?.planityUrl),
    hasTreatwell: salon.bookingTool === "TREATWELL" || Boolean(salon.prospect?.treatwellUrl),
    hasOtherBookingTool: ["BOOKSY", "FRESHA", "ACUITY"].includes(salon.bookingTool),
    instagramFollowers: salon.prospect?.instagramFollowers ?? null,
    threeMonthGrowthPct: growth.growthPct,
    googleRating: salon.rating,
    googleReviewCount: salon.prospect?.reviewCount ?? null,
    postalCode: salon.prospect?.postalCode ?? null,
    zone: salon.prospect?.zone ?? null,
    address: salon.address,
  });

  const demoAccountReady = salon.onboardingJobs.some(
    (j) => j.status === "DONE" || j.status === "ALREADY_ONBOARDED",
  );
  const recentNotes = [
    ...salon.transcripts.map((t) => t.summary).filter((x): x is string => Boolean(x)),
    ...salon.activities.map((a) => a.notes).filter((x): x is string => Boolean(x)),
  ];

  const recommendedAngle = salon.gtmAngle ?? gtm.angle ?? "Fidélisation et marketing";
  let brief = buildFallbackScoutBrief({
    salonName: salon.name,
    bookingTool: salon.bookingTool,
    hasPlanity: salon.bookingTool === "PLANITY" || Boolean(salon.prospect?.planityUrl),
    hasTreatwell: salon.bookingTool === "TREATWELL" || Boolean(salon.prospect?.treatwellUrl),
    instagram: salon.instagram,
    instagramFollowers: salon.prospect?.instagramFollowers ?? null,
    recommendedAngle,
    demoAccountReady,
    growthPct: growth.growthPct,
    recentNotes,
  });

  const assigneeId = requestedById ?? salon.opportunities[0]?.ownerId ?? salon.assignedToId;
  let usage: unknown = undefined;

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const budget = await checkUserAiBudget(assigneeId);
    if (budget.allowed) {
      try {
        const llm = await runCachedHaikuJson({
          systemPrompt: SCOUT_SYSTEM_PROMPT,
          userPayload: {
            salon: {
              name: salon.name,
              address: salon.address,
              metier: salon.metier,
              bookingTool: salon.bookingTool,
              instagram: salon.instagram,
              followers: salon.prospect?.instagramFollowers ?? null,
              rating: salon.rating,
              reviews: salon.prospect?.reviewCount ?? null,
              notes: salon.notes,
              objection: salon.objection,
            },
            gtm: { score: gtm.score, priority: gtm.priority, recommendedAngle },
            growthPct: growth.growthPct,
            demoAccountReady,
            contacts: salon.contacts.map((c) => ({ name: c.name, role: c.role, isDecisionMaker: c.isDecisionMaker })),
            recentNotes: recentNotes.slice(0, 5),
          },
          parse: (raw) => scoutBriefSchema.parse(raw),
          maxTokens: 900,
        });
        brief = { ...llm.output, demoAccountReady };
        usage = llm.usage;
      } catch (err) {
        console.error("[SCOUT] LLM fallback used:", err);
      }
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salon.id },
      data: {
        prepBriefJson: brief as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        prepBriefUpdatedAt: now,
      },
    });
    await tx.agentSuggestion.create({
      data: {
        agent: "SCOUT",
        kind: "PREP_BRIEF",
        targetType: "SALON",
        targetId: salon.id,
        salonId: salon.id,
        opportunityId: salon.opportunities[0]?.id ?? null,
        assignedToId: assigneeId,
        title: `Fiche préparation SCOUT · ${salon.name}`,
        proposedPayload: brief as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        generationReport: {
          ...brief.generationReport,
          ...(usage ? { usage } : {}),
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      },
    });
  });

  return brief;
}

/**
 * Worker sweep: prepares SCOUT briefs automatically J-1 / H-1 for upcoming VISIO / VISITE meetings.
 */
export async function runScoutUpcomingSweep(now = new Date()) {
  const horizon = new Date(now.getTime() + 26 * 60 * 60 * 1000);
  const staleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const upcoming = await prisma.activity.findMany({
    where: {
      type: { in: ["VISIO", "VISITE", "DEMO"] },
      scheduledAt: { gte: now, lte: horizon },
      salon: {
        archivedAt: null,
        OR: [{ prepBriefUpdatedAt: null }, { prepBriefUpdatedAt: { lt: staleCutoff } }],
      },
    },
    select: { salonId: true, userId: true },
    distinct: ["salonId"],
    take: 15,
  });

  let generated = 0;
  for (const act of upcoming) {
    try {
      await generateScoutBriefForSalon(act.salonId, act.userId);
      generated++;
    } catch (err) {
      console.error(`[SCOUT] failed for salon ${act.salonId}:`, err);
    }
  }

  return { upcomingCount: upcoming.length, generated };
}
