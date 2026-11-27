"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isManagerOrAdmin, requireMember } from "@/lib/access";
import { mapStageToSalonStatus, OPPORTUNITY_STAGE_ORDER, startOfCurrentParisMonth } from "@/lib/pipeline/stages";
import { fetchAlloTranscript } from "./allo";
import { runEchoExtraction, twelveMonthsAgo } from "./echo";
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
    source: z.enum(["UPLOAD", "WISPR_FLOW", "ALLO"]).default("UPLOAD"),
    durationSec: z.coerce.number().int().min(0).max(36000).optional(),
    rawTranscript: z.string().trim().min(15).max(50000),
  }).parse(Object.fromEntries(fd));

  const salon = await prisma.salon.findFirst({
    where: { id: d.salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
    select: { id: true },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

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
      userId: user.id,
      durationSec: d.durationSec ?? null,
      rawTranscript: d.rawTranscript,
      matchStatus: "MATCHED",
    },
  });

  // Attempt immediate ECHO processing when ANTHROPIC_API_KEY is available; otherwise worker picks it up
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try {
      await processTranscriptWithEcho(rec.id);
    } catch (err) {
      console.error("[ECHO] immediate extraction deferred to worker:", err);
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

  const salon = await prisma.salon.findFirst({
    where: { id: salonId, archivedAt: null, ...(isManagerOrAdmin(user) ? {} : { assignedToId: user.id }) },
    select: { id: true },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  const opp = await prisma.opportunity.findFirst({
    where: { salonId: salon.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  await prisma.transcriptRecord.update({
    where: { id: transcriptId },
    data: { salonId: salon.id, opportunityId: opp?.id ?? null, matchStatus: "MATCHED" },
  });

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try {
      await processTranscriptWithEcho(transcriptId);
    } catch (err) {
      console.error("[ECHO] attach extraction deferred:", err);
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
    }
  });

  revalidatePath("/suggestions");
  revalidatePath("/pipeline");
  revalidatePath("/taches");
  revalidatePath("/dashboard");
  if (suggestion.salonId) revalidatePath(`/salons/${suggestion.salonId}`);
  redirect(returnTo);
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
