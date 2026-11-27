"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isManagerOrAdmin, requireAdmin, requireManager, requireMember } from "@/lib/access";
import { isDisputeWindowOpen } from "./engine";
import { syncBillingAndCommissions } from "./stripe-sync";

export async function raiseCommissionDispute(fd: FormData) {
  const user = await requireMember();
  const commissionId = z.string().min(1).parse(fd.get("commissionId"));
  const reason = z.string().trim().min(5).max(2000).parse(fd.get("reason"));

  const comm = await prisma.commission.findFirst({
    where: { id: commissionId, ...(isManagerOrAdmin(user) ? {} : { ownerId: user.id }) },
  });
  if (!comm) throw new Error("Commission introuvable.");
  if (!isDisputeWindowOpen(comm.settledAt)) {
    redirect(`/remuneration?error=${encodeURIComponent("La fenêtre de contestation de 15 jours est close.")}`);
  }

  await prisma.commissionDispute.create({
    data: { commissionId: comm.id, raisedById: user.id, reason },
  });
  revalidatePath("/remuneration");
  redirect("/remuneration");
}

export async function resolveCommissionDispute(fd: FormData) {
  const reviewer = await requireManager();
  const disputeId = z.string().min(1).parse(fd.get("disputeId"));
  const status = z.enum(["RESOLVED_UPHELD", "RESOLVED_ADJUSTED", "REJECTED"]).parse(fd.get("status"));
  const resolutionNote = z.string().trim().min(2).max(2000).parse(fd.get("resolutionNote"));

  await prisma.commissionDispute.update({
    where: { id: disputeId },
    data: { status, resolutionNote, resolvedById: reviewer.id, resolvedAt: new Date() },
  });
  revalidatePath("/remuneration");
}

/** Strictly ADMIN-only: marks an acquired commission as paid out (VERSEE). */
export async function markCommissionPaid(fd: FormData) {
  await requireAdmin();
  const commissionId = z.string().min(1).parse(fd.get("commissionId"));
  const updated = await prisma.commission.updateMany({
    where: { id: commissionId, status: "ACQUISE" },
    data: { status: "VERSEE", settledAt: new Date() },
  });
  if (updated.count === 0) {
    redirect(`/remuneration?error=${encodeURIComponent("Seule une commission acquise peut être marquée versée.")}`);
  }
  revalidatePath("/remuneration");
  redirect("/remuneration?notice=Commission%20marqu%C3%A9e%20vers%C3%A9e.");
}

export async function saveSalesGoal(fd: FormData) {
  await requireManager();
  const d = z.object({
    userId: z.string().min(1),
    periodKey: z.string().regex(/^\d{4}-\d{2}$/),
    targetMrrEur: z.coerce.number().min(0).max(50000),
    targetMeetings: z.coerce.number().int().min(0).max(500),
    targetDmCalls: z.coerce.number().int().min(0).max(2000),
    isRampMonth: z.string().optional(),
  }).parse(Object.fromEntries(fd));

  await prisma.salesGoal.upsert({
    where: { userId_periodKey: { userId: d.userId, periodKey: d.periodKey } },
    create: {
      userId: d.userId,
      periodKey: d.periodKey,
      targetMrrEur: d.targetMrrEur,
      targetMeetings: d.targetMeetings,
      targetDmCalls: d.targetDmCalls,
      isRampMonth: d.isRampMonth === "on" || d.isRampMonth === "true",
    },
    update: {
      targetMrrEur: d.targetMrrEur,
      targetMeetings: d.targetMeetings,
      targetDmCalls: d.targetDmCalls,
      isRampMonth: d.isRampMonth === "on" || d.isRampMonth === "true",
    },
  });
  revalidatePath("/remuneration");
  revalidatePath("/pilotage");
  revalidatePath("/dashboard");
}

export async function triggerBillingSync() {
  await requireManager();
  const res = await syncBillingAndCommissions();
  revalidatePath("/remuneration");
  revalidatePath("/pilotage");
  revalidatePath("/pipeline");
  const msg = res.skippedReason
    ? res.skippedReason
    : `Sync OK : ${res.salonsChecked} salons, ${res.invoicesUpserted} factures, ${res.commissionsUpdated} commissions mises à jour.`;
  redirect(`/remuneration?notice=${encodeURIComponent(msg)}`);
}
