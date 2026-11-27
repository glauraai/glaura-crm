"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isManagerOrAdmin, requireManager, requireMember } from "@/lib/access";
import { canonicalizePhone } from "@/lib/phone";
import { convertProspectInTx } from "@/lib/prospection/convert";
import type { OpportunityStage } from "@/generated/prisma/enums";
import {
  PORTFOLIO_ACTIVE_CAP,
  OPPORTUNITY_STAGE_ORDER,
  isValidStageTransitionInput,
  mapStageToSalonStatus,
  nextRoundRobinUserId,
} from "./stages";
import { scoreAccountGtm1Bis } from "@/lib/gtm/scoring";
import {
  DEFAULT_PLAN_RULES,
  calculateDealCommissionBase,
  monthKeyForDate,
  quarterKeyForDate,
} from "@/lib/commissions/engine";

const stageSchema = z.enum(OPPORTUNITY_STAGE_ORDER as [OpportunityStage, ...OpportunityStage[]]);

function revalidatePipeline(salonId?: string) {
  revalidatePath("/pipeline");
  revalidatePath("/salons");
  revalidatePath("/prospection");
  revalidatePath("/dashboard");
  revalidatePath("/remuneration");
  if (salonId) revalidatePath(`/salons/${salonId}`);
}

export async function createOpportunity(fd: FormData) {
  const user = await requireMember();
  const salonId = z.string().min(1).parse(fd.get("salonId"));
  const title = z.string().trim().min(1).max(160).parse(fd.get("title") || "Abonnement Glaura");
  const rawAmount = fd.get("monthlyAmountEur");
  const monthlyAmountEur = rawAmount && String(rawAmount).trim() ? Number(rawAmount) : null;

  const salon = await prisma.salon.findFirst({
    where: { id: salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
    select: { id: true, assignedToId: true },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  await prisma.$transaction(async (tx) => {
    const opp = await tx.opportunity.create({
      data: {
        salonId: salon.id,
        title,
        stage: "A_CONTACTER",
        monthlyAmountEur: monthlyAmountEur && Number.isFinite(monthlyAmountEur) && monthlyAmountEur > 0 ? monthlyAmountEur : null,
        ownerId: salon.assignedToId ?? user.id,
      },
    });
    await tx.stageTransition.create({
      data: { opportunityId: opp.id, fromStage: null, toStage: "A_CONTACTER", changedById: user.id, source: "MANUAL" },
    });
  });

  revalidatePipeline(salon.id);
}

export async function moveOpportunityStage(fd: FormData) {
  const user = await requireMember();
  const opportunityId = z.string().min(1).parse(fd.get("opportunityId"));
  const nextStage = stageSchema.parse(fd.get("stage"));
  const lossReason = typeof fd.get("lossReason") === "string" ? String(fd.get("lossReason")).trim() : null;
  const nextStep = typeof fd.get("nextStep") === "string" ? String(fd.get("nextStep")).trim() || undefined : undefined;
  const returnTo = typeof fd.get("returnTo") === "string" && String(fd.get("returnTo")).startsWith("/") ? String(fd.get("returnTo")) : null;

  const check = isValidStageTransitionInput(nextStage, lossReason);
  if (!check.ok) {
    if (returnTo) redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(check.error)}`);
    throw new Error(check.error);
  }

  const opp = await prisma.opportunity.findFirst({
    where: {
      id: opportunityId,
      ...(isManagerOrAdmin(user) ? {} : { OR: [{ ownerId: user.id }, { salon: { assignedToId: user.id } }] }),
    },
    include: { salon: { select: { id: true, assignedToId: true } }, subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!opp) throw new Error("Opportunité introuvable ou inaccessible.");

  const now = new Date();
  const signingNow = nextStage === "SIGNE" && !opp.ownerLockedAt;
  const lockedOwnerId = opp.ownerId ?? opp.salon.assignedToId ?? user.id;

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: opp.id },
      data: {
        stage: nextStage,
        ...(nextStage === "PERDU" ? { lossReason } : {}),
        ...(nextStep !== undefined ? { nextStep } : {}),
        ...(signingNow ? { ownerId: lockedOwnerId, ownerLockedAt: now, signedAt: now } : {}),
      },
    });
    if (opp.stage !== nextStage) {
      await tx.stageTransition.create({
        data: { opportunityId: opp.id, fromStage: opp.stage, toStage: nextStage, changedById: user.id, source: "MANUAL" },
      });
    }
    await tx.salon.update({
      where: { id: opp.salonId },
      data: {
        status: mapStageToSalonStatus(nextStage),
        ...(signingNow ? { signedAt: now } : {}),
        ...(nextStage === "COMPTE_ACTIVE" ? { activatedAt: now } : {}),
      },
    });

    // When a deal reaches SIGNE, automatically create/ensure its Commission row tied to the active quarterly plan
    if (nextStage === "SIGNE" && lockedOwnerId) {
      const quarterKey = quarterKeyForDate(now);
      let plan = await tx.commissionPlanVersion.findUnique({ where: { quarterKey } });
      if (!plan) {
        const y = now.getUTCFullYear();
        const q = Math.floor(now.getUTCMonth() / 3);
        plan = await tx.commissionPlanVersion.create({
          data: {
            quarterKey,
            effectiveFrom: new Date(Date.UTC(y, q * 3, 1)),
            effectiveTo: new Date(Date.UTC(y, q * 3 + 3, 0, 23, 59, 59)),
          },
        });
      }
      const latestSub = opp.subscriptions[0];
      const mrrSignedEur = latestSub ? latestSub.listMonthlyCents / 100 : (opp.monthlyAmountEur ?? 0);
      const cadence = latestSub?.cadence ?? "MONTHLY";
      const discountPercent = latestSub?.discountPercent ?? 0;
      const baseAmountEur = calculateDealCommissionBase(
        { mrrSignedEur, cadence, discountPercent },
        { ...DEFAULT_PLAN_RULES, baseRate: plan.baseRate },
      );

      await tx.commission.upsert({
        where: { opportunityId: opp.id },
        create: {
          opportunityId: opp.id,
          ownerId: lockedOwnerId,
          planVersionId: plan.id,
          signedMonth: monthKeyForDate(now),
          cadence,
          mrrSignedEur,
          discountPercent,
          effectiveRate: plan.baseRate,
          baseAmountEur,
          finalAmountEur: baseAmountEur,
          status: "PREVUE",
        },
        update: {
          mrrSignedEur,
          cadence,
          discountPercent,
          baseAmountEur,
        },
      });
    }
  });

  revalidatePipeline(opp.salonId);
  if (returnTo) redirect(returnTo);
}

export async function reassignOpportunity(fd: FormData) {
  const admin = await requireManager();
  const opportunityId = z.string().min(1).parse(fd.get("opportunityId"));
  const toUserId = z.string().min(1).parse(fd.get("toUserId"));
  const reason = z.string().trim().min(3).max(500).parse(fd.get("reason"));

  const [opp, target] = await Promise.all([
    prisma.opportunity.findUnique({ where: { id: opportunityId } }),
    prisma.user.findFirst({ where: { id: toUserId, active: true } }),
  ]);
  if (!opp) throw new Error("Opportunité introuvable.");
  if (!target) throw new Error("Commercial introuvable ou inactif.");

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({ where: { id: opp.id }, data: { ownerId: target.id } });
    await tx.ownershipAuditLog.create({
      data: { opportunityId: opp.id, fromUserId: opp.ownerId, toUserId: target.id, changedById: admin.id, reason },
    });
    await tx.commission.updateMany({ where: { opportunityId: opp.id }, data: { ownerId: target.id } });
  });

  revalidatePipeline(opp.salonId);
}

export async function addContact(fd: FormData) {
  const user = await requireMember();
  const d = z.object({
    salonId: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    role: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().max(200).optional(),
    isDecisionMaker: z.string().optional(),
  }).parse(Object.fromEntries(fd));

  const salon = await prisma.salon.findFirst({
    where: { id: d.salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
    select: { id: true },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  await prisma.contact.create({
    data: {
      salonId: salon.id,
      name: d.name,
      role: d.role || null,
      isDecisionMaker: d.isDecisionMaker === "on" || d.isDecisionMaker === "true",
      phone: d.phone || null,
      phoneNormalized: d.phone ? canonicalizePhone(d.phone) : null,
      email: d.email?.toLowerCase() || null,
    },
  });

  revalidatePath(`/salons/${salon.id}`);
}

/**
 * Commercial 1-click claim from the shared Prospect pool into their portfolio.
 * Nov 27 brief: single owner lock + 120 active accounts max per portfolio (1-for-1 swap).
 */
export async function claimProspectToPortfolio(fd: FormData) {
  const user = await requireMember();
  const prospectId = z.string().min(1).parse(fd.get("prospectId"));
  let error: string | null = null;
  let createdSalonId: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      if (!isManagerOrAdmin(user)) {
        const activePortfolioCount = await tx.salon.count({
          where: {
            assignedToId: user.id,
            archivedAt: null,
            status: { not: "SIGNE" },
          },
        });
        if (activePortfolioCount >= PORTFOLIO_ACTIVE_CAP) {
          throw new Error(
            `Portefeuille complet (${activePortfolioCount}/${PORTFOLIO_ACTIVE_CAP} comptes actifs). Rendez d’abord un compte au pool commun (échange 1 pour 1).`,
          );
        }
      }

      const prospect = await tx.prospect.findUnique({
        where: { id: prospectId },
        include: { tournee: true },
      });
      if (!prospect) throw new Error("Prospect introuvable.");
      if (prospect.assignedToId && prospect.assignedToId !== user.id) {
        throw new Error("Ce compte appartient déjà à un autre commercial.");
      }
      if (prospect.status !== "NOUVEAU" && prospect.assignedToId !== user.id) {
        throw new Error("Ce prospect n’est plus disponible.");
      }

      const now = new Date();
      const claim = await tx.prospect.updateMany({
        where: { id: prospect.id, status: "NOUVEAU", assignedToId: null },
        data: { assignedToId: user.id, status: "EN_TOURNEE", claimedAt: now },
      });
      if (!claim.count && prospect.assignedToId !== user.id) {
        throw new Error("Ce compte vient d’être pris par un autre commercial.");
      }

      const refreshed = await tx.prospect.findUniqueOrThrow({ where: { id: prospect.id }, include: { tournee: true } });
      const salonId = await convertProspectInTx(tx, refreshed, user.id);
      if (salonId) {
        createdSalonId = salonId;
        const gtm = scoreAccountGtm1Bis({
          isChainOrFranchise: refreshed.aiOwnership === "chain_or_franchise",
          instagramHandle: refreshed.instagram,
          igStatus: refreshed.igStatus,
          hasPlanity: Boolean(refreshed.planityUrl) || refreshed.source === "PLANITY",
          hasTreatwell: Boolean(refreshed.treatwellUrl) || refreshed.source === "TREATWELL",
          hasOtherBookingTool: refreshed.source === "BOOKSY" || refreshed.source === "FRESHA",
          instagramFollowers: refreshed.instagramFollowers,
          googleRating: refreshed.googleRating ?? refreshed.rating,
          googleReviewCount: refreshed.googleReviewCount ?? refreshed.reviewCount,
          postalCode: refreshed.postalCode,
          zone: refreshed.zone,
          address: refreshed.address,
        });
        await tx.salon.update({
          where: { id: salonId },
          data: {
            siret: refreshed.siret ?? undefined,
            portfolioClaimedAt: now,
            portfolioClaimedById: user.id,
            inactivityWarnedAt: null,
            gtmScore: gtm.score,
            gtmPriority: gtm.priority,
            gtmAngle: gtm.angle,
            gtmScoreBreakdown: {
              igUnverified: gtm.igUnverified,
              filterReason: gtm.filterReason,
              criteria: gtm.breakdown,
            } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
            gtmScoredAt: now,
          },
        });
        const opp = await tx.opportunity.create({
          data: { salonId, title: "Abonnement Glaura", stage: "A_CONTACTER", ownerId: user.id },
        });
        await tx.stageTransition.create({
          data: { opportunityId: opp.id, fromStage: null, toStage: "A_CONTACTER", changedById: user.id, source: "SYSTEM" },
        });
      }
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Impossible d’ajouter ce compte.";
  }

  revalidatePipeline(createdSalonId ?? undefined);
  if (error) redirect(`/prospection?tab=shared&error=${encodeURIComponent(error)}`);
  if (createdSalonId) redirect(`/salons/${createdSalonId}`);
  redirect("/prospection?tab=shared");
}

/**
 * Releases an active salon from a rep's portfolio back to the common pool (1-for-1 swap).
 * Signed/paid accounts cannot be released.
 */
export async function releaseSalonToPool(fd: FormData) {
  const user = await requireMember();
  const salonId = z.string().min(1).parse(fd.get("salonId"));
  const returnTo =
    typeof fd.get("returnTo") === "string" && String(fd.get("returnTo")).startsWith("/")
      ? String(fd.get("returnTo"))
      : "/salons";

  const salon = await prisma.salon.findFirst({
    where: {
      id: salonId,
      archivedAt: null,
      ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }),
    },
    include: {
      prospect: { select: { id: true } },
      opportunities: { select: { id: true, stage: true, ownerLockedAt: true } },
    },
  });
  if (!salon) throw new Error("Salon introuvable ou non attribué à votre portefeuille.");
  if (
    salon.status === "SIGNE" ||
    salon.opportunities.some((o) => o.ownerLockedAt || ["ABONNE", "COMPTE_ACTIVE", "SIGNE", "ENCAISSE"].includes(o.stage))
  ) {
    throw new Error("Un compte signé ou abonné ne peut pas être rendu au pool commun.");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salon.id },
      data: {
        assignedToId: null,
        portfolioClaimedAt: null,
        portfolioClaimedById: null,
        inactivityWarnedAt: null,
      },
    });
    if (salon.prospect?.id) {
      await tx.prospect.update({
        where: { id: salon.prospect.id },
        data: { status: "NOUVEAU", assignedToId: null, tourneeId: null, claimedAt: null },
      });
    }
    await tx.salesTask.updateMany({
      where: { salonId: salon.id, doneAt: null },
      data: { doneAt: now, outcome: `Rendu au pool commun par ${user.name ?? user.email}.` },
    });
    await tx.activity.create({
      data: {
        salonId: salon.id,
        userId: user.id,
        type: "NOTE",
        source: "MANUAL",
        notes: `Compte rendu au pool commun par ${user.name ?? user.email} (échange portefeuille 1 pour 1).`,
      },
    });
  });

  revalidatePipeline(salon.id);
  redirect(returnTo);
}

/**
 * Assigns an inbound "Être appelé" salon in round-robin across active COMMERCIAL users.
 */
export async function assignInboundRoundRobin(salonId: string): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const reps = await tx.user.findMany({
      where: { active: true, role: "COMMERCIAL" },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const state = await tx.roundRobinState.findUnique({ where: { id: "default" } });
    const chosenId = nextRoundRobinUserId(reps.map((r) => r.id), state?.lastAssignedId ?? null);
    if (!chosenId) return null;

    await tx.roundRobinState.upsert({
      where: { id: "default" },
      create: { id: "default", lastAssignedId: chosenId },
      update: { lastAssignedId: chosenId },
    });
    await tx.salon.update({
      where: { id: salonId },
      data: { assignedToId: chosenId, type: "A", priorityLabel: "Priorité A — Lead entrant" },
    });
    const existingOpp = await tx.opportunity.findFirst({ where: { salonId } });
    if (!existingOpp) {
      const opp = await tx.opportunity.create({
        data: { salonId, title: "Lead entrant — Être appelé", stage: "A_CONTACTER", ownerId: chosenId },
      });
      await tx.stageTransition.create({
        data: { opportunityId: opp.id, fromStage: null, toStage: "A_CONTACTER", source: "SYSTEM" },
      });
    } else if (!existingOpp.ownerLockedAt) {
      await tx.opportunity.update({ where: { id: existingOpp.id }, data: { ownerId: chosenId } });
    }
    return chosenId;
  });
}
