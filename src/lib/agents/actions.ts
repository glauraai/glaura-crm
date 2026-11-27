"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isManagerOrAdmin, requireManager, requireMember } from "@/lib/access";
import { mapStageToSalonStatus, OPPORTUNITY_STAGE_ORDER, startOfCurrentParisMonth } from "@/lib/pipeline/stages";
import { canonicalizePhone } from "@/lib/phone";
import { fetchAlloTranscript } from "./allo";
import { runEchoExtraction, twelveMonthsAgo } from "./echo";
import { generateScoutBriefForSalon } from "./scout";
import { generateCraftProposalForSalon } from "./craft";
import { runSentinelSweep } from "./sentinel";
import { evaluateTranscriptWithMentor } from "./mentor";
import { runGtmRescoreAndSnapshots } from "@/lib/gtm/routing";
import type { BillingCadence } from "@/generated/prisma/enums";
import {
  configuredMonthlyBudgetEur,
  configuredMonthlyRunLimit,
  extractUsageCostEur,
  isMonthlyAiBudgetExceeded,
} from "./budget";

/**
 * Processes a matched TranscriptRecord through ECHO (Claude Sonnet 4.6)
 * and creates PENDING AgentSuggestion rows — NEVER mutating CRM data silently.
 */
export async function processTranscriptWithEcho(transcriptId: string) {
  const record = await prisma.transcriptRecord.findUnique({
    where: { id: transcriptId },
    include: {
      salon: { select: { id: true, name: true, assignedToId: true } },
      opportunity: { select: { id: true, stage: true, ownerId: true } },
    },
  });
  if (!record || !record.salonId || !record.salon) return { skipped: true };
  if (record.echoProcessedAt) return { alreadyProcessed: true };

  let text = record.rawTranscript?.trim() || "";
  if (!text && record.source === "ALLO") {
    const fetched = await fetchAlloTranscript(record.externalId);
    if (fetched) {
      text = fetched;
      await prisma.transcriptRecord.update({ where: { id: record.id }, data: { rawTranscript: fetched } });
    }
  }
  if (!text) text = record.summary?.trim() || "";
  if (!text) return { empty: true };

  const opp =
    record.opportunity ??
    (await prisma.opportunity.findFirst({
      where: { salonId: record.salonId },
      orderBy: { createdAt: "desc" },
      select: { id: true, stage: true, ownerId: true },
    }));

  const assigneeId = opp?.ownerId ?? record.salon.assignedToId ?? record.userId;

  // Enforce per-user monthly AI budget (default 10 EUR/user/month, Haiku 5.5)
  if (assigneeId) {
    const monthStart = startOfCurrentParisMonth();
    const monthlySuggestions = await prisma.agentSuggestion.findMany({
      where: { assignedToId: assigneeId, createdAt: { gte: monthStart } },
      select: { generationReport: true },
    });
    const spentEur = monthlySuggestions.reduce((sum, s) => sum + extractUsageCostEur(s.generationReport), 0);
    const budgetCheck = isMonthlyAiBudgetExceeded({
      spentEur,
      runsThisMonth: monthlySuggestions.length,
      budgetEur: configuredMonthlyBudgetEur(),
      maxRuns: configuredMonthlyRunLimit(),
    });
    if (budgetCheck.exceeded) {
      return { skipped: true, budgetExceeded: true, reason: budgetCheck.reason };
    }
  }

  const { output: echo, usage } = await runEchoExtraction({
    salonName: record.salon.name,
    currentStage: opp?.stage ?? "A_CONTACTER",
    sourceLabel: `${record.source} (${record.externalId})`,
    durationSec: record.durationSec,
    transcriptText: text,
  });

  await prisma.$transaction(async (tx) => {
    await tx.transcriptRecord.update({
      where: { id: record.id },
      data: {
        opportunityId: opp?.id ?? null,
        isDecisionMakerCall: echo.isDecisionMakerCall,
        echoProcessedAt: new Date(),
      },
    });

    // 1. Qualification + decision-maker proposal
    await tx.agentSuggestion.create({
      data: {
        agent: "ECHO",
        kind: "QUALIFICATION_UPDATE",
        targetType: "OPPORTUNITY",
        targetId: opp?.id ?? record.salonId,
        salonId: record.salonId,
        opportunityId: opp?.id ?? null,
        assignedToId: assigneeId,
        title: `Compte rendu ECHO · ${record.salon!.name}`,
        proposedPayload: {
          transcriptId: record.id,
          isDecisionMakerCall: echo.isDecisionMakerCall,
          decisionMakerName: echo.decisionMakerName ?? null,
          decisionMakerRole: echo.decisionMakerRole ?? null,
          qualification: echo.qualification,
          objections: echo.objections,
          proposedStage: echo.proposedStage ?? null,
          nextStep: echo.nextStep ?? null,
          nextStepDate: echo.nextStepDate ?? null,
          durationSec: record.durationSec,
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        generationReport: { ...echo.generationReport, usage } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      },
    });
  });

  return { ok: true };
}

export async function uploadTranscript(fd: FormData) {
  const user = await requireMember();
  const d = z.object({
    salonId: z.string().min(1),
    contactId: z.string().optional(),
    source: z.enum(["UPLOAD", "WISPR_FLOW", "ALLO"]).default("UPLOAD"),
    durationSec: z.coerce.number().int().min(0).max(36000).optional(),
    rawTranscript: z.string().trim().min(15).max(50000),
  }).parse(Object.fromEntries(fd));

  const salon = await prisma.salon.findFirst({
    where: { id: d.salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
    select: { id: true, contacts: { orderBy: { isDecisionMaker: "desc" }, select: { id: true } } },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  const validContactId =
    d.contactId && salon.contacts.some((c) => c.id === d.contactId)
      ? d.contactId
      : salon.contacts[0]?.id ?? null;

  const opp = await prisma.opportunity.findFirst({
    where: { salonId: salon.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const rec = await prisma.transcriptRecord.create({
    data: {
      source: d.source,
      externalId: `manual_${randomUUID()}`,
      salonId: salon.id,
      opportunityId: opp?.id ?? null,
      contactId: validContactId,
      userId: user.id,
      durationSec: d.durationSec ?? null,
      rawTranscript: d.rawTranscript,
      matchStatus: "MATCHED",
    },
  });

  // Attempt immediate ECHO + MENTOR processing when ANTHROPIC_API_KEY is available; otherwise worker picks it up
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try {
      await processTranscriptWithEcho(rec.id);
      await evaluateTranscriptWithMentor(rec.id);
    } catch (err) {
      console.error("[ECHO/MENTOR] immediate extraction deferred to worker:", err);
    }
  }

  revalidatePath("/suggestions");
  revalidatePath(`/salons/${salon.id}`);
  redirect("/suggestions");
}

export async function attachUnmatchedTranscript(fd: FormData) {
  const user = await requireMember();
  const transcriptId = z.string().min(1).parse(fd.get("transcriptId"));
  const salonId = z.string().min(1).parse(fd.get("salonId"));

  const [salon, transcript] = await Promise.all([
    prisma.salon.findFirst({
      where: { id: salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
      select: { id: true, contacts: { orderBy: { isDecisionMaker: "desc" }, select: { id: true, phoneNormalized: true, email: true } } },
    }),
    prisma.transcriptRecord.findUnique({ where: { id: transcriptId }, select: { callerPhone: true, participantEmails: true } }),
  ]);
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  const callerNorm = transcript?.callerPhone ? canonicalizePhone(transcript.callerPhone) : null;
  const emailSet = new Set((transcript?.participantEmails ?? []).map((e) => e.toLowerCase()));
  const matchedContact =
    salon.contacts.find((c) => (callerNorm && c.phoneNormalized === callerNorm) || (c.email && emailSet.has(c.email.toLowerCase()))) ??
    salon.contacts[0] ??
    null;

  const opp = await prisma.opportunity.findFirst({
    where: { salonId: salon.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  await prisma.transcriptRecord.update({
    where: { id: transcriptId },
    data: {
      salonId: salon.id,
      opportunityId: opp?.id ?? null,
      contactId: matchedContact?.id ?? null,
      matchStatus: "MATCHED",
    },
  });

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try {
      await processTranscriptWithEcho(transcriptId);
      await evaluateTranscriptWithMentor(transcriptId);
    } catch (err) {
      console.error("[ECHO/MENTOR] attach extraction deferred:", err);
    }
  }

  revalidatePath("/suggestions");
  revalidatePath(`/salons/${salon.id}`);
}

export async function reviewSuggestion(fd: FormData) {
  const user = await requireMember();
  const id = z.string().min(1).parse(fd.get("suggestionId"));
  const decision = z.enum(["APPROVED", "MODIFIED", "REJECTED"]).parse(fd.get("decision"));
  const editedStage = typeof fd.get("proposedStage") === "string" && String(fd.get("proposedStage")).trim() ? String(fd.get("proposedStage")).trim() : null;
  const editedNextStep = typeof fd.get("nextStep") === "string" ? String(fd.get("nextStep")).trim() : null;
  const editedNextStepDate = typeof fd.get("nextStepDate") === "string" ? String(fd.get("nextStepDate")).trim() : null;
  const editedDecisionMaker = fd.get("isDecisionMakerCall");
  const returnTo = typeof fd.get("returnTo") === "string" && String(fd.get("returnTo")).startsWith("/") ? String(fd.get("returnTo")) : "/suggestions";

  const suggestion = await prisma.agentSuggestion.findFirst({
    where: {
      id,
      status: "PENDING",
      ...(isManagerOrAdmin(user) ? {} : { OR: [{ assignedToId: user.id }, { salon: { assignedToId: user.id } }] }),
    },
  });
  if (!suggestion) throw new Error("Suggestion introuvable ou déjà traitée.");

  const proposed = (suggestion.proposedPayload ?? {}) as Record<string, unknown>;
  const applied: Record<string, unknown> = {
    ...proposed,
    ...(decision === "MODIFIED"
      ? {
          ...(editedStage !== null ? { proposedStage: editedStage } : {}),
          ...(editedNextStep !== null ? { nextStep: editedNextStep } : {}),
          ...(editedNextStepDate !== null ? { nextStepDate: editedNextStepDate } : {}),
          ...(editedDecisionMaker !== null ? { isDecisionMakerCall: editedDecisionMaker === "true" || editedDecisionMaker === "on" } : {}),
        }
      : {}),
  };

  await prisma.$transaction(async (tx) => {
    await tx.agentSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: decision,
        appliedPayload: decision === "REJECTED" ? undefined : (applied as import("@/generated/prisma/client").Prisma.InputJsonValue),
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });

    if (decision === "REJECTED") return;

    // Apply validated/modified ECHO qualification, activity, stage & follow-up task
    if (suggestion.kind === "QUALIFICATION_UPDATE" && suggestion.salonId) {
      const isDm = Boolean(applied.isDecisionMakerCall);
      const transcriptId = typeof applied.transcriptId === "string" ? applied.transcriptId : null;
      const durationSec = typeof applied.durationSec === "number" ? applied.durationSec : null;
      const nextStep = typeof applied.nextStep === "string" && applied.nextStep.trim() ? applied.nextStep.trim() : null;
      const nextStepDateStr = typeof applied.nextStepDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(applied.nextStepDate) ? applied.nextStepDate : null;
      const nextStage =
        typeof applied.proposedStage === "string" && (OPPORTUNITY_STAGE_ORDER as string[]).includes(applied.proposedStage)
          ? (applied.proposedStage as import("@/generated/prisma/enums").OpportunityStage)
          : null;

      await tx.activity.create({
        data: {
          salonId: suggestion.salonId,
          opportunityId: suggestion.opportunityId,
          userId: user.id,
          type: "APPEL",
          source: "ALLO",
          durationSec,
          isDecisionMakerCall: isDm,
          transcriptId,
          notes: nextStep ? `Validé ECHO — Prochaine étape : ${nextStep}` : "Compte rendu ECHO validé.",
        },
      });

      if (transcriptId) {
        await tx.transcriptRecord.updateMany({
          where: { id: transcriptId },
          data: { isDecisionMakerCall: isDm },
        });
      }

      if (suggestion.opportunityId) {
        const opp = await tx.opportunity.findUnique({ where: { id: suggestion.opportunityId } });
        if (opp) {
          await tx.opportunity.update({
            where: { id: opp.id },
            data: {
              qualificationJson: (applied.qualification ?? opp.qualificationJson) as import("@/generated/prisma/client").Prisma.InputJsonValue,
              ...(nextStep ? { nextStep } : {}),
              ...(nextStepDateStr ? { nextStepAt: new Date(`${nextStepDateStr}T12:00:00Z`) } : {}),
              ...(nextStage && nextStage !== "PERDU" ? { stage: nextStage } : {}),
            },
          });
          if (nextStage && nextStage !== "PERDU" && nextStage !== opp.stage) {
            await tx.stageTransition.create({
              data: { opportunityId: opp.id, fromStage: opp.stage, toStage: nextStage, changedById: user.id, source: "AGENT_VALIDATED" },
            });
            await tx.salon.update({
              where: { id: suggestion.salonId },
              data: { status: mapStageToSalonStatus(nextStage) },
            });
          }
        }
      }

      if (nextStep) {
        const dueAt = nextStepDateStr
          ? new Date(`${nextStepDateStr}T17:00:00Z`)
          : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        await tx.salesTask.create({
          data: {
            title: nextStep.slice(0, 200),
            assignedToId: suggestion.assignedToId ?? user.id,
            salonId: suggestion.salonId,
            dueAt,
          },
        });
      }

      // Persist validated ECHO objections into ObjectionRecord for MENTOR / Pilotage analytics
      if (Array.isArray(applied.objections) && applied.objections.length > 0) {
        const validObjs = (applied.objections as Array<Record<string, unknown>>).filter(
          (o) => typeof o?.category === "string" && typeof o?.verbatim === "string",
        );
        if (validObjs.length > 0) {
          await tx.objectionRecord.createMany({
            data: validObjs.map((o) => ({
              transcriptId,
              salonId: suggestion.salonId,
              opportunityId: suggestion.opportunityId,
              userId: user.id,
              category: String(o.category),
              verbatim: String(o.verbatim),
              responseGiven: typeof o.responseGiven === "string" ? o.responseGiven : null,
            })),
          });
        }
      }
    }

    // Apply SENTINEL relance suggestion: create follow-up task & resolve risk flag status
    if (suggestion.kind === "RELANCE" && suggestion.salonId) {
      const taskTitle =
        typeof applied.nextStep === "string" && applied.nextStep.trim()
          ? applied.nextStep.trim()
          : typeof applied.taskTitle === "string" && applied.taskTitle.trim()
            ? applied.taskTitle.trim()
            : suggestion.title;
      const followUpMessage = typeof applied.followUpMessage === "string" ? applied.followUpMessage : null;
      await tx.salesTask.create({
        data: {
          title: taskTitle.slice(0, 200),
          context: followUpMessage,
          assignedToId: suggestion.assignedToId ?? user.id,
          salonId: suggestion.salonId,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      if (suggestion.opportunityId) {
        await tx.opportunity.update({
          where: { id: suggestion.opportunityId },
          data: { riskHandledStatus: "RESOLVED" },
        });
      }
    }

    // Apply CRAFT quote draft: create SubscriptionLine DRAFT + J+2 follow-up task
    if (suggestion.kind === "QUOTE_DRAFT" && suggestion.salonId) {
      const cadenceRaw = typeof applied.cadence === "string" ? applied.cadence : "MONTHLY";
      const cadence: BillingCadence =
        cadenceRaw === "ANNUAL_1X" || cadenceRaw === "ANNUAL_3X" ? cadenceRaw : "MONTHLY";
      const listMonthlyCents = Number(applied.listMonthlyCents ?? 3900);
      const netMonthlyCents = Number(applied.netMonthlyCents ?? listMonthlyCents);
      await tx.subscriptionLine.create({
        data: {
          salonId: suggestion.salonId,
          opportunityId: suggestion.opportunityId,
          planCode: typeof applied.planCode === "string" ? applied.planCode : "salon_solo",
          label: typeof applied.label === "string" ? applied.label : "Abonnement Glaura",
          cadence,
          listMonthlyCents: Number.isFinite(listMonthlyCents) ? listMonthlyCents : 3900,
          netMonthlyCents: Number.isFinite(netMonthlyCents) ? netMonthlyCents : 3900,
          freeMonths: Number(applied.freeMonths ?? 0) || 0,
          lauraChannels: typeof applied.lauraChannels === "string" ? applied.lauraChannels : null,
          lauraCents: Number(applied.lauraCents ?? 0) || 0,
          syncIncluded: Boolean(applied.syncIncluded),
          syncCents: Number(applied.syncCents ?? 0) || 0,
          status: "DRAFT",
          createdById: user.id,
        },
      });
      await tx.salesTask.create({
        data: {
          title: `Relancer devis CRAFT (J+2) · ${suggestion.title.slice(0, 120)}`,
          assignedToId: suggestion.assignedToId ?? user.id,
          salonId: suggestion.salonId,
          dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      });
    }

    // Apply CRAFT email draft: queue EmailJob if recipient email present + J+2 follow-up task
    if (suggestion.kind === "EMAIL_DRAFT" && suggestion.salonId) {
      const to = typeof applied.to === "string" ? applied.to.trim() : "";
      const subject = typeof applied.subject === "string" ? applied.subject.trim() : suggestion.title;
      const body = typeof applied.body === "string" ? applied.body.trim() : "";
      if (to && body) {
        await tx.emailJob.create({
          data: {
            salonId: suggestion.salonId,
            requestedById: user.id,
            to,
            templateKey: "craft_recap",
            subject,
            format: "TEXT",
            body,
            status: "QUEUED",
          },
        });
      }
      await tx.salesTask.create({
        data: {
          title: (typeof applied.nextStep === "string" && applied.nextStep.trim() ? applied.nextStep : "Relancer suite à l’email CRAFT").slice(0, 200),
          assignedToId: suggestion.assignedToId ?? user.id,
          salonId: suggestion.salonId,
          dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      });
    }
  });

  // If ECHO validated nextStep asks for a quote/offer, automatically queue a CRAFT proposal draft
  if (
    decision !== "REJECTED" &&
    suggestion.kind === "QUALIFICATION_UPDATE" &&
    suggestion.salonId &&
    typeof applied.nextStep === "string" &&
    /devis|offre|proposition|lien/i.test(applied.nextStep)
  ) {
    try {
      await generateCraftProposalForSalon(suggestion.salonId, user.id);
    } catch (err) {
      console.error("[CRAFT] auto-trigger after ECHO failed:", err);
    }
  }

  revalidatePath("/suggestions");
  revalidatePath("/pipeline");
  revalidatePath("/pilotage");
  revalidatePath("/taches");
  revalidatePath("/dashboard");
  if (suggestion.salonId) revalidatePath(`/salons/${suggestion.salonId}`);
  redirect(returnTo);
}

export async function triggerScoutBrief(fd: FormData) {
  const user = await requireMember();
  const salonId = z.string().min(1).parse(fd.get("salonId"));
  const salon = await prisma.salon.findFirst({
    where: { id: salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
    select: { id: true },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  await generateScoutBriefForSalon(salon.id, user.id);
  revalidatePath(`/salons/${salon.id}`);
  revalidatePath("/suggestions");
  redirect(`/salons/${salon.id}?scoutNotice=${encodeURIComponent("Brief SCOUT généré et ajouté aux Suggestions IA.")}`);
}

export async function triggerCraftProposal(fd: FormData) {
  const user = await requireMember();
  const salonId = z.string().min(1).parse(fd.get("salonId"));
  const salon = await prisma.salon.findFirst({
    where: { id: salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
    select: { id: true },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  await generateCraftProposalForSalon(salon.id, user.id);
  revalidatePath(`/salons/${salon.id}`);
  revalidatePath("/suggestions");
  redirect(`/suggestions`);
}

export async function triggerSentinelScan() {
  await requireManager();
  await runSentinelSweep();
  revalidatePath("/pilotage");
  revalidatePath("/suggestions");
  revalidatePath("/pipeline");
  redirect("/pilotage#sentinel");
}

export async function triggerGtmRescore() {
  await requireManager();
  await runGtmRescoreAndSnapshots();
  revalidatePath("/prospection");
  revalidatePath("/salons");
  revalidatePath("/pilotage");
  redirect("/prospection");
}

export async function saveCrmAutomationConfig(fd: FormData) {
  const user = await requireManager();
  const cTierNurtureEnabled = fd.get("cTierNurtureEnabled") === "on" || fd.get("cTierNurtureEnabled") === "true";
  const decemberPauseEnabled = fd.get("decemberPauseEnabled") === "on" || fd.get("decemberPauseEnabled") === "true";
  const inactivityWarningDays = Math.max(15, Math.min(85, Number(fd.get("inactivityWarningDays")) || 75));
  const inactivityReleaseDays = Math.max(inactivityWarningDays + 5, Math.min(180, Number(fd.get("inactivityReleaseDays")) || 90));

  await prisma.crmAutomationConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      cTierNurtureEnabled,
      decemberPauseEnabled,
      inactivityWarningDays,
      inactivityReleaseDays,
      updatedById: user.id,
    },
    update: {
      cTierNurtureEnabled,
      decemberPauseEnabled,
      inactivityWarningDays,
      inactivityReleaseDays,
      updatedById: user.id,
    },
  });

  revalidatePath("/automatisations");
  redirect("/automatisations?saved=1");
}

export async function purgeExpiredRawTranscripts(now = new Date()): Promise<number> {
  const cutoff = twelveMonthsAgo(now);
  const res = await prisma.transcriptRecord.updateMany({
    where: {
      occurredAt: { lt: cutoff },
      rawTranscript: { not: null },
    },
    data: {
      rawTranscript: null,
      purgedAt: now,
    },
  });
  return res.count;
}
