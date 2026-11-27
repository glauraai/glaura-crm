import { prisma } from "@/lib/db";
import { getDb } from "@/lib/firebase-admin";
import { DEFAULT_PLAN_RULES, evaluateCommissionLifecycle } from "./engine";

type StripeInvoiceApi = {
  id: string;
  customer: string;
  subscription?: string | null;
  amount_paid: number;
  status: string;
  billing_reason?: string | null;
  status_transitions?: { paid_at?: number | null };
  charge?: string | { refunded?: boolean; disputed?: boolean } | null;
};

/**
 * Syncs activation state from Firestore `prod-eu/userProfile/{providerId}`
 * and Stripe paid invoices / refunds / disputes using the read-only key (`STRIPE_READONLY_KEY`),
 * then updates Commission statuses (PREVUE -> EN_VALIDATION -> ACQUISE / PERDUE).
 */
export async function syncBillingAndCommissions(): Promise<{
  salonsChecked: number;
  invoicesUpserted: number;
  commissionsUpdated: number;
  skippedReason?: string;
}> {
  const stripeKey = process.env.STRIPE_READONLY_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim();
  const salons = await prisma.salon.findMany({
    where: { archivedAt: null, providerId: { not: null } },
    select: { id: true, providerId: true, activatedAt: true },
  });

  if (!salons.length) {
    return { salonsChecked: 0, invoicesUpserted: 0, commissionsUpdated: 0 };
  }

  const db = getDb();
  let invoicesUpserted = 0;

  for (const salon of salons) {
    if (!salon.providerId) continue;
    try {
      const snap = await db.collection("userProfile").doc(salon.providerId).get();
      if (!snap.exists) continue;
      const profile = snap.data() ?? {};

      // Sync activation timestamp if provider became active in Glaura
      const isEnabled = profile.isEnable === true || profile.isEnabled === true || profile.accountStatus === "active";
      if (isEnabled && !salon.activatedAt) {
        const now = new Date();
        await prisma.salon.update({ where: { id: salon.id }, data: { activatedAt: now } });
        await prisma.opportunity.updateMany({
          where: { salonId: salon.id, stage: "ABONNE" },
          data: { stage: "COMPTE_ACTIVE" },
        });
      }

      const stripeCustomerId = typeof profile.stripeCustomerId === "string" ? profile.stripeCustomerId.trim() : "";
      if (!stripeCustomerId || !stripeKey) continue;

      const url = `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(stripeCustomerId)}&limit=24&expand[]=data.charge`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${stripeKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const payload = (await res.json()) as { data?: StripeInvoiceApi[] };

      for (const inv of payload.data ?? []) {
        const chargeObj = inv.charge && typeof inv.charge === "object" ? inv.charge : null;
        const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : null;
        await prisma.syncedInvoice.upsert({
          where: { stripeInvoiceId: inv.id },
          create: {
            stripeInvoiceId: inv.id,
            providerId: salon.providerId,
            salonId: salon.id,
            stripeCustomerId,
            stripeSubscriptionId: typeof inv.subscription === "string" ? inv.subscription : null,
            amountPaidCents: inv.amount_paid ?? 0,
            status: inv.status,
            paidAt,
            refunded: Boolean(chargeObj?.refunded),
            disputed: Boolean(chargeObj?.disputed),
            billingReason: inv.billing_reason ?? null,
          },
          update: {
            amountPaidCents: inv.amount_paid ?? 0,
            status: inv.status,
            paidAt,
            refunded: Boolean(chargeObj?.refunded),
            disputed: Boolean(chargeObj?.disputed),
          },
        });
        invoicesUpserted++;
      }
    } catch (err) {
      console.error(`[billing-sync] failed for salon ${salon.id}:`, err);
    }
  }

  // Recompute Commission statuses from SyncedInvoice
  const commissions = await prisma.commission.findMany({
    where: { status: { in: ["PREVUE", "EN_VALIDATION"] } },
    include: {
      planVersion: true,
      opportunity: { select: { id: true, salonId: true, stage: true } },
    },
  });

  let commissionsUpdated = 0;
  for (const comm of commissions) {
    const invoices = await prisma.syncedInvoice.findMany({
      where: { salonId: comm.opportunity.salonId },
      orderBy: { paidAt: "asc" },
    });
    const validPaid = invoices.filter((i) => i.status === "paid" && i.amountPaidCents > 0 && !i.refunded && !i.disputed);
    const hasRefundOrDispute = invoices.some((i) => i.refunded || i.disputed);
    const cancelled = comm.opportunity.stage === "PERDU";

    const nextStatus = evaluateCommissionLifecycle(
      {
        cadence: comm.cadence,
        validPaidInvoices: validPaid.length,
        cancelled,
        refundedOrDisputed: hasRefundOrDispute,
      },
      {
        ...DEFAULT_PLAN_RULES,
        excludeCancelledBeforeTwoInvoices: comm.planVersion.excludeCancelledBeforeTwoInvoices,
      },
    );

    if (nextStatus !== comm.status || validPaid.length !== comm.paidInvoicesCount) {
      await prisma.commission.update({
        where: { id: comm.id },
        data: {
          status: nextStatus,
          paidInvoicesCount: validPaid.length,
          ...(nextStatus === "ACQUISE" && !comm.acquiredAt ? { acquiredAt: new Date() } : {}),
        },
      });
      if (validPaid.length >= 1 && ["SIGNE", "ABONNE", "COMPTE_ACTIVE"].includes(comm.opportunity.stage)) {
        await prisma.opportunity.update({ where: { id: comm.opportunity.id }, data: { stage: "ENCAISSE" } });
      }
      commissionsUpdated++;
    }
  }

  return {
    salonsChecked: salons.length,
    invoicesUpserted,
    commissionsUpdated,
    ...(!stripeKey ? { skippedReason: "STRIPE_READONLY_KEY non configurée (activation Firestore synchronisée uniquement)." } : {}),
  };
}
