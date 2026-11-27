import { prisma } from "@/lib/db";

export const DEFAULT_INACTIVITY_WARNING_DAYS = 75;
export const DEFAULT_INACTIVITY_RELEASE_DAYS = 90;

export type InactivityDecision = {
  status: "ACTIVE" | "WARN" | "RELEASE";
  inactiveDays: number;
};

export function classifyPortfolioInactivity(
  lastActivityAt: Date,
  now = new Date(),
  options?: { warningDays?: number; releaseDays?: number },
): InactivityDecision {
  const warningDays = options?.warningDays ?? DEFAULT_INACTIVITY_WARNING_DAYS;
  const releaseDays = options?.releaseDays ?? DEFAULT_INACTIVITY_RELEASE_DAYS;
  const diffMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const inactiveDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (inactiveDays >= releaseDays) return { status: "RELEASE", inactiveDays };
  if (inactiveDays >= warningDays) return { status: "WARN", inactiveDays };
  return { status: "ACTIVE", inactiveDays };
}

/**
 * Daily sweep enforcing the Nov 27 brief portfolio rule:
 * - Warning task after `inactivityWarningDays` (default 75d) without activity
 * - Automatic return to common pool after `inactivityReleaseDays` (default 90d / 3 months)
 *   without activity (signed/won accounts are never released).
 */
export async function runPortfolioInactivitySweep(now = new Date()) {
  const config = await prisma.crmAutomationConfig.findUnique({ where: { id: "default" } });
  const warningDays = config?.inactivityWarningDays ?? DEFAULT_INACTIVITY_WARNING_DAYS;
  const releaseDays = config?.inactivityReleaseDays ?? DEFAULT_INACTIVITY_RELEASE_DAYS;
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const salons = await prisma.salon.findMany({
    where: {
      archivedAt: null,
      assignedToId: { not: null },
      status: { not: "SIGNE" },
    },
    select: {
      id: true,
      name: true,
      assignedToId: true,
      inactivityWarnedAt: true,
      portfolioClaimedAt: true,
      lastContactedAt: true,
      updatedAt: true,
      activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      transcripts: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      opportunities: { select: { stage: true } },
      prospect: { select: { id: true } },
    },
  });

  let warned = 0;
  let released = 0;

  for (const salon of salons) {
    if (!salon.assignedToId) continue;
    if (salon.opportunities.some((o) => ["ABONNE", "COMPTE_ACTIVE", "SIGNE", "ENCAISSE"].includes(o.stage))) {
      continue;
    }

    const timestamps = [
      salon.activities[0]?.createdAt,
      salon.transcripts[0]?.occurredAt,
      salon.lastContactedAt,
      salon.portfolioClaimedAt,
      salon.updatedAt,
    ].filter((d): d is Date => d instanceof Date);
    const lastActivityAt = timestamps.sort((a, b) => b.getTime() - a.getTime())[0] ?? salon.updatedAt;

    const decision = classifyPortfolioInactivity(lastActivityAt, now, { warningDays, releaseDays });
    if (decision.status === "ACTIVE") {
      if (salon.inactivityWarnedAt) {
        await prisma.salon.update({ where: { id: salon.id }, data: { inactivityWarnedAt: null } });
      }
      continue;
    }

    if (decision.status === "WARN" && !salon.inactivityWarnedAt) {
      const remainingDays = Math.max(1, releaseDays - decision.inactiveDays);
      await prisma.$transaction(async (tx) => {
        await tx.salon.update({ where: { id: salon.id }, data: { inactivityWarnedAt: now } });
        await tx.salesTask.upsert({
          where: { requestKey: `inactivity-warn:${salon.id}:${monthKey}` },
          create: {
            requestKey: `inactivity-warn:${salon.id}:${monthKey}`,
            title: `Inactivité (${decision.inactiveDays} j) — ${salon.name} retourne au pool dans ${remainingDays} j`,
            context: "Sans activité enregistrée pendant 3 mois, ce compte retourne automatiquement dans la base commune.",
            assignedToId: salon.assignedToId!,
            salonId: salon.id,
            dueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
          },
          update: {},
        });
      });
      warned++;
    } else if (decision.status === "RELEASE") {
      await prisma.$transaction(async (tx) => {
        await tx.salon.update({
          where: { id: salon.id },
          data: { assignedToId: null, inactivityWarnedAt: null, portfolioClaimedAt: null, portfolioClaimedById: null },
        });
        if (salon.prospect?.id) {
          await tx.prospect.update({
            where: { id: salon.prospect.id },
            data: { status: "NOUVEAU", assignedToId: null, tourneeId: null, claimedAt: null },
          });
        }
        await tx.salesTask.updateMany({
          where: { salonId: salon.id, doneAt: null },
          data: { doneAt: now, outcome: `Retour automatique au pool commun après ${decision.inactiveDays} jours sans activité.` },
        });
        await tx.activity.create({
          data: {
            salonId: salon.id,
            type: "NOTE",
            source: "SYSTEM",
            notes: `Compte remis automatiquement dans le pool commun après ${decision.inactiveDays} jours sans activité (règle 3 mois).`,
          },
        });
      });
      released++;
    }
  }

  return { scanned: salons.length, warned, released };
}
