import { prisma } from "@/lib/db";
import { monthKeyForDate } from "@/lib/commissions/engine";
import {
  computeThreeMonthAudienceGrowth,
  isDecemberPause,
  scoreAccountGtm1Bis,
  type GtmPriority,
} from "./scoring";
import { parseLeadNotes } from "./notes-parser";
import { computeCompositeRankScore } from "./pipeline";

export const C_TIER_NURTURE_SEQUENCE = [
  {
    step: 0,
    delayDays: 0,
    key: "c_tier_video_booking",
    subject: "Vos vidéos Instagram peuvent remplir votre agenda en 3 clics",
    body: "Bonjour {{contact}},\n\nBeaucoup de salons actifs sur Instagram perdent des clientes entre un reel et la prise de rendez-vous. Avec Glaura, vos clientes réservent directement depuis vos vidéos, sans commission sur votre clientèle.\n\nSi vous souhaitez voir un exemple concret sur votre salon, répondez simplement à cet email.\n\nBien cordialement,\nL’équipe Glaura (glaura.ai) — Pour ne plus recevoir ces messages pro, répondez STOP ou cliquez sur le lien de désinscription.",
  },
  {
    step: 1,
    delayDays: 14,
    key: "c_tier_case_study",
    subject: "Comment un salon partenaire réduit ses créneaux vides",
    body: "Bonjour {{contact}},\n\nUn salon proche de votre profil utilise les relances automatiques Glaura pour faire revenir ses clientes au bon moment selon leur prestation, sans y passer de temps le soir.\n\nSouhaitez-vous que l’on vous prépare un aperçu gratuit pour {{salon}} ?\n\nBien cordialement,\nL’équipe Glaura (glaura.ai) — Désinscription sur simple réponse STOP.",
  },
  {
    step: 2,
    delayDays: 28,
    key: "c_tier_targeted_promos",
    subject: "Remplir vos heures creuses sans brader tout votre salon",
    body: "Bonjour {{contact}},\n\nContrairement aux plateformes qui imposent des remises globales, Glaura vous permet de cibler une prestation précise, un créneau précis et un nombre limité de places.\n\nDisponible 10 min cette semaine pour vous montrer ?\n\nBien cordialement,\nL’équipe Glaura (glaura.ai) — Désinscription sur simple réponse STOP.",
  },
  {
    step: 3,
    delayDays: 42,
    key: "c_tier_free_website",
    subject: "Votre site personnalisé (valeur 500 €) offert avec l’abonnement annuel",
    body: "Bonjour {{contact}},\n\nAvec l’abonnement annuel Glaura (Salon solo ou Salon équipe), votre site web personnalisé est offert et prêt en quelques jours, relié à votre agenda en ligne.\n\nRépondez à cet email si vous souhaitez réserver une démo de 15 min.\n\nBien cordialement,\nL’équipe Glaura (glaura.ai) — Désinscription sur simple réponse STOP.",
  },
] as const;

export type GtmRoutingAction =
  | { kind: "PAUSED_DECEMBER"; reason: string }
  | { kind: "PRIORITY_A_ALERT"; tasks: Array<{ title: string; dueInDays: number }> }
  | { kind: "PRIORITY_B_SEQUENCE"; tasks: Array<{ title: string; dueInDays: number }> }
  | { kind: "PRIORITY_C_NURTURE"; enabled: boolean; step: number }
  | { kind: "NONE"; reason: string };

export function buildGtmRoutingPlan(input: {
  priority: GtmPriority;
  salonName: string;
  now?: Date;
  decemberPauseEnabled?: boolean;
  cTierNurtureEnabled?: boolean;
  nurtureStep?: number;
}): GtmRoutingAction {
  const now = input.now ?? new Date();
  const pauseEnabled = input.decemberPauseEnabled ?? true;

  if (pauseEnabled && isDecemberPause(now)) {
    return {
      kind: "PAUSED_DECEMBER",
      reason: "Pause du 20 au 31 décembre : aucune tâche d’appel/visite ni campagne C créée.",
    };
  }

  if (input.priority === "A") {
    return {
      kind: "PRIORITY_A_ALERT",
      tasks: [{ title: `[Priorité A] Appeler ${input.salonName} sous 48 h pour fixer une visite`, dueInDays: 2 }],
    };
  }

  if (input.priority === "B") {
    return {
      kind: "PRIORITY_B_SEQUENCE",
      tasks: [
        { title: `[Priorité B · 1/3] Appel découverte — ${input.salonName}`, dueInDays: 1 },
        { title: `[Priorité B · 2/3] DM Instagram depuis le CRM — ${input.salonName}`, dueInDays: 4 },
        { title: `[Priorité B · 3/3] Appel de relance — ${input.salonName}`, dueInDays: 10 },
      ],
    };
  }

  if (input.priority === "C") {
    return {
      kind: "PRIORITY_C_NURTURE",
      enabled: Boolean(input.cTierNurtureEnabled),
      step: input.nurtureStep ?? 0,
    };
  }

  return { kind: "NONE", reason: `Priorité ${input.priority} hors routage commercial standard.` };
}

/**
 * Monthly / on-demand GTM 1 bis rescore + SocialSnapshot recorder for Salons and Prospects.
 */
export async function runGtmRescoreAndSnapshots(now = new Date(), limit = 5000) {
  const monthKey = monthKeyForDate(now);

  const [salons, prospects] = await Promise.all([
    prisma.salon.findMany({
      where: { archivedAt: null },
      orderBy: [{ assignedToId: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: limit,
      include: {
        prospect: {
          select: {
            planityUrl: true,
            treatwellUrl: true,
            instagramFollowers: true,
            igStatus: true,
            aiOwnership: true,
            activeSites: true,
            revenueEur: true,
            revenueYear: true,
            revenueStatus: true,
            legalEntity: true,
            siren: true,
            filingUrl: true,
            notes: true,
            reviewCount: true,
            postalCode: true,
            zone: true,
          },
        },
        socialSnapshots: { orderBy: { monthKey: "asc" }, take: 6 },
      },
    }),
    prisma.prospect.findMany({
      where: { status: { in: ["NOUVEAU", "EN_TOURNEE"] } },
      orderBy: [{ assignedToId: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: limit,
      include: { socialSnapshots: { orderBy: { monthKey: "asc" }, take: 6 } },
    }),
  ]);

  let salonsScored = 0;
  let prospectsScored = 0;
  let snapshotsUpserted = 0;

  for (const s of salons) {
    const followers = s.prospect?.instagramFollowers ?? null;
    if (followers != null || s.rating != null) {
      await prisma.socialSnapshot.upsert({
        where: { salonId_monthKey: { salonId: s.id, monthKey } },
        create: {
          salonId: s.id,
          monthKey,
          igFollowers: followers,
          googleReviews: s.prospect?.reviewCount ?? null,
          googleRating: s.rating,
        },
        update: {
          igFollowers: followers ?? undefined,
          googleReviews: s.prospect?.reviewCount ?? undefined,
          googleRating: s.rating ?? undefined,
        },
      });
      snapshotsUpserted++;
    }

    const growth = computeThreeMonthAudienceGrowth(s.socialSnapshots);
    const parsedNotes = parseLeadNotes(`${s.notes ?? ""}\n${s.prospect?.notes ?? ""}`);
    const existingBd = (s.gtmScoreBreakdown ?? {}) as Record<string, unknown>;
    const videosPerWeek = typeof existingBd.videosPerWeek === "number" ? existingBd.videosPerWeek : null;
    const staffCount =
      parsedNotes.staffCount ?? (typeof existingBd.staffCount === "number" ? existingBd.staffCount : null);
    const result = scoreAccountGtm1Bis({
      alreadyClient: s.status === "SIGNE" || Boolean(s.providerId && s.activatedAt),
      isChainOrFranchise:
        s.prospect?.aiOwnership === "chain_or_franchise" || (s.prospect?.activeSites ?? 0) >= 5,
      instagramHandle: existingBd.sharedIgHandle ? null : s.instagram,
      igStatus: s.prospect?.igStatus ?? (s.instagram ? "CONFIRME" : "A_FAIRE"),
      hasPlanity: s.bookingTool === "PLANITY" || Boolean(s.prospect?.planityUrl) || parsedNotes.hasPlanityHint,
      hasTreatwell: s.bookingTool === "TREATWELL" || Boolean(s.prospect?.treatwellUrl) || parsedNotes.hasTreatwellHint,
      hasOtherBookingTool: ["BOOKSY", "FRESHA", "ACUITY"].includes(s.bookingTool) || parsedNotes.hasOtherToolHint,
      videosPerWeek,
      postsVideos: videosPerWeek != null ? videosPerWeek > 0 : Boolean(parsedNotes.tiktokHandle),
      instagramFollowers: existingBd.sharedIgHandle ? null : followers,
      staffCount,
      threeMonthGrowthPct: growth.growthPct,
      googleRating: s.rating ?? parsedNotes.ratingHint,
      googleReviewCount: s.prospect?.reviewCount ?? parsedNotes.reviewCountHint ?? null,
      sellsProducts: parsedNotes.sellsProductsHint,
      postalCode: s.prospect?.postalCode ?? null,
      zone: s.prospect?.zone ?? null,
      address: s.address,
      isInboundLead: Boolean(s.priorityLabel?.includes("Lead entrant")),
    });

    const compositeScore = computeCompositeRankScore({
      gtmScore: result.score,
      revenueEur: s.prospect?.revenueEur,
      revenueStatus: s.prospect?.revenueStatus,
    });

    await prisma.salon.update({
      where: { id: s.id },
      data: {
        gtmScore: result.score,
        gtmPriority: result.priority,
        gtmAngle: result.angle,
        gtmScoreBreakdown: {
          ...existingBd,
          igUnverified: result.igUnverified,
          filterReason: result.filterReason,
          growthPct: growth.growthPct,
          revenueEur: s.prospect?.revenueEur ?? existingBd.revenueEur ?? null,
          revenueYear: s.prospect?.revenueYear ?? existingBd.revenueYear ?? null,
          revenueStatus: s.prospect?.revenueStatus ?? existingBd.revenueStatus ?? null,
          legalEntity: s.prospect?.legalEntity ?? existingBd.legalEntity ?? null,
          siren: s.prospect?.siren ?? existingBd.siren ?? null,
          filingUrl: s.prospect?.filingUrl ?? existingBd.filingUrl ?? null,
          compositeScore,
          criteria: result.breakdown,
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        gtmScoredAt: now,
      },
    });
    salonsScored++;
  }

  for (const p of prospects) {
    if (p.instagramFollowers != null || p.reviewCount > 0) {
      await prisma.socialSnapshot.upsert({
        where: { prospectId_monthKey: { prospectId: p.id, monthKey } },
        create: {
          prospectId: p.id,
          monthKey,
          igFollowers: p.instagramFollowers,
          googleReviews: p.googleReviewCount ?? p.reviewCount,
          googleRating: p.googleRating ?? p.rating,
        },
        update: {
          igFollowers: p.instagramFollowers ?? undefined,
          googleReviews: p.googleReviewCount ?? p.reviewCount,
          googleRating: p.googleRating ?? p.rating ?? undefined,
        },
      });
      snapshotsUpserted++;
    }

    const growth = computeThreeMonthAudienceGrowth(p.socialSnapshots);
    const result = scoreAccountGtm1Bis({
      alreadyClient: p.status === "DEJA_CRM",
      isChainOrFranchise: p.aiOwnership === "chain_or_franchise" || (p.activeSites ?? 0) >= 5,
      instagramHandle: p.instagram,
      igStatus: p.igStatus,
      hasPlanity: Boolean(p.planityUrl) || p.source === "PLANITY",
      hasTreatwell: Boolean(p.treatwellUrl) || p.source === "TREATWELL",
      hasOtherBookingTool: p.source === "BOOKSY" || p.source === "FRESHA",
      instagramFollowers: p.instagramFollowers,
      threeMonthGrowthPct: growth.growthPct,
      googleRating: p.googleRating ?? p.rating,
      googleReviewCount: p.googleReviewCount ?? p.reviewCount,
      postalCode: p.postalCode,
      zone: p.zone,
      address: p.address,
    });

    await prisma.prospect.update({
      where: { id: p.id },
      data: {
        gtmScore: result.score,
        gtmPriority: result.priority,
        gtmAngle: result.angle,
        gtmScoreBreakdown: {
          igUnverified: result.igUnverified,
          filterReason: result.filterReason,
          growthPct: growth.growthPct,
          criteria: result.breakdown,
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        gtmScoredAt: now,
      },
    });
    prospectsScored++;
  }

  return { monthKey, salonsScored, prospectsScored, snapshotsUpserted };
}
