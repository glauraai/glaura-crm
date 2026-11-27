"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireMember } from "@/lib/access";
import type { BillingCadence } from "@/generated/prisma/enums";
import { calculateOfferPricing } from "./catalog";
import { requestStripeOfferLink } from "./offer-link";

export async function createSubscriptionOffer(fd: FormData) {
  const user = await requireMember();
  const d = z.object({
    salonId: z.string().min(1),
    opportunityId: z.string().optional(),
    planCode: z.string().min(1),
    cadence: z.enum(["MONTHLY", "ANNUAL_3X", "ANNUAL_1X"]).default("MONTHLY"),
    lauraChannels: z.string().optional(),
    syncIncluded: z.string().optional(),
    discountPercent: z.coerce.number().min(0).max(90).default(0),
    generateStripeLink: z.string().optional(),
    returnTo: z.string().optional(),
  }).parse(Object.fromEntries(fd));

  const salon = await prisma.salon.findFirst({
    where: { id: d.salonId, archivedAt: null, ...(user.role === "ADMIN" ? {} : { assignedToId: user.id }) },
    include: { onboardingJobs: { where: { accountUid: { not: null } }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!salon) throw new Error("Salon introuvable ou inaccessible.");

  const providerId = salon.providerId ?? salon.onboardingJobs[0]?.accountUid ?? null;
  const pricing = calculateOfferPricing({
    planCode: d.planCode,
    cadence: d.cadence as BillingCadence,
    lauraChannels: d.lauraChannels && d.lauraChannels !== "none" ? d.lauraChannels : null,
    syncIncluded: d.syncIncluded === "on" || d.syncIncluded === "true",
    discountPercent: d.discountPercent,
  });

  let checkoutUrl: string | null = null;
  let notice: string | null = null;

  if (d.generateStripeLink === "on" || d.generateStripeLink === "true") {
    if (!providerId) {
      notice = "Devis enregistré. Préparez d’abord le compte Glaura du salon pour générer un lien de paiement Stripe.";
    } else {
      const linkRes = await requestStripeOfferLink({
        providerId,
        planCode: d.planCode,
        cadence: d.cadence as BillingCadence,
        lauraChannels: d.lauraChannels && d.lauraChannels !== "none" ? d.lauraChannels : null,
        netMonthlyCents: pricing.netMonthlyCents,
        freeMonths: pricing.freeMonths,
      });
      if (linkRes.ok) {
        checkoutUrl = linkRes.url;
      } else {
        notice = linkRes.error;
      }
    }
  }

  const oppId =
    d.opportunityId ||
    (await prisma.opportunity.findFirst({ where: { salonId: salon.id }, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id ||
    null;

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionLine.create({
      data: {
        salonId: salon.id,
        opportunityId: oppId,
        planCode: pricing.plan.code,
        label: pricing.plan.name,
        cadence: d.cadence as BillingCadence,
        listMonthlyCents: pricing.listMonthlyCents,
        discountPercent: d.discountPercent,
        netMonthlyCents: pricing.netMonthlyCents,
        freeMonths: pricing.freeMonths,
        lauraChannels: d.lauraChannels && d.lauraChannels !== "none" ? d.lauraChannels : null,
        lauraCents: pricing.lauraCents,
        syncIncluded: d.syncIncluded === "on" || d.syncIncluded === "true",
        syncCents: pricing.syncCents,
        checkoutUrl,
        status: checkoutUrl ? "SENT" : "DRAFT",
        createdById: user.id,
      },
    });

    if (oppId) {
      await tx.opportunity.update({
        where: { id: oppId },
        data: { monthlyAmountEur: pricing.mrrSignedEur },
      });
    }
  });

  revalidatePath("/tarifs");
  revalidatePath(`/salons/${salon.id}`);
  revalidatePath("/pipeline");
  const dest = d.returnTo?.startsWith("/") ? d.returnTo : `/salons/${salon.id}`;
  if (notice) redirect(`${dest}${dest.includes("?") ? "&" : "?"}offerNotice=${encodeURIComponent(notice)}`);
  redirect(dest);
}
