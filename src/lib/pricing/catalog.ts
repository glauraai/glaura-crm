import type { BillingCadence } from "@/generated/prisma/enums";

export type GlauraPlanSpec = {
  code: string;
  stripeV3Code: string | null; // maps to goglow-firebase proV3Catalog.PLANS
  name: string;
  monthlyHtCents: number;
  targetSegment: string;
  freeWebsiteOnAnnual: boolean;
  highlights: string[];
};

export const GLAURA_PLANS: readonly GlauraPlanSpec[] = [
  {
    code: "essentiel_v3",
    stripeV3Code: "essentiel_v3",
    name: "Indépendante (Essentiel)",
    monthlyHtCents: 1490,
    targetSegment: "Indépendante / auto-entrepreneure",
    freeWebsiteOnAnnual: false,
    highlights: ["Agenda en ligne & page salon", "Réservation depuis les vidéos", "0 % commission sur vos clientes"],
  },
  {
    code: "salon_solo",
    stripeV3Code: "solo_pro_v3",
    name: "Salon solo (Grille 24/11)",
    monthlyHtCents: 3900,
    targetSegment: "Salon 1 praticien",
    freeWebsiteOnAnnual: true,
    highlights: ["Tout-en-un solo + fidélisation", "Relances clientes automatiques", "Site personnalisé (500 €) offert en annuel"],
  },
  {
    code: "salon_v3",
    stripeV3Code: "salon_v3",
    name: "Salon équipe",
    monthlyHtCents: 7900,
    targetSegment: "Salon 2 à 10 agendas",
    freeWebsiteOnAnnual: true,
    highlights: ["Multi-praticiens & caisse NF525", "Pilotage, fidélisation & marketing", "Site personnalisé (500 €) offert en annuel"],
  },
] as const;

export type LauraOptionSpec = {
  code: string;
  label: string;
  monthlyHtCents: number;
};

export const LAURA_OPTIONS: readonly LauraOptionSpec[] = [
  { code: "none", label: "Sans option Laura IA", monthlyHtCents: 0 },
  { code: "instagram", label: "Laura IA — Instagram", monthlyHtCents: 5900 },
  { code: "whatsapp", label: "Laura IA — WhatsApp", monthlyHtCents: 5900 },
  { code: "both", label: "Laura IA — Instagram + WhatsApp", monthlyHtCents: 9900 },
  { code: "phone", label: "Laura IA — Téléphone seul / supplément", monthlyHtCents: 9900 },
  { code: "full", label: "Laura IA — Pack complet (IG + WA + Tél)", monthlyHtCents: 19800 },
  { code: "marketing_only", label: "Laura Marketing seul", monthlyHtCents: 5900 },
] as const;

export const SYNC_OPTION_CENTS = 1900; // Synchronisation Planity / Treatwell : 19 € HT/mois
export const VAT_RATE = 0.2;

export type OfferPricingInput = {
  planCode: string;
  cadence: BillingCadence;
  lauraChannels: string | null;
  syncIncluded: boolean;
  discountPercent: number;
};

export type OfferPricingResult = {
  plan: GlauraPlanSpec;
  lauraCents: number;
  syncCents: number;
  listMonthlyCents: number;
  netMonthlyCents: number;
  mrrSignedEur: number;
  freeMonths: number;
  annualTotalHtCents: number | null;
  todayHtCents: number;
  todayVatCents: number;
  todayTtcCents: number;
  freeWebsiteIncluded: boolean;
  commissionDiscountFactor: number;
};

export function calculateOfferPricing(input: OfferPricingInput): OfferPricingResult {
  const plan = GLAURA_PLANS.find((p) => p.code === input.planCode) ?? GLAURA_PLANS[0];
  const discount = Math.max(0, Math.min(90, Number.isFinite(input.discountPercent) ? input.discountPercent : 0));

  const lauraSpec = LAURA_OPTIONS.find((o) => o.code === (input.lauraChannels ?? "none")) ?? LAURA_OPTIONS[0];
  const lauraCents = lauraSpec.monthlyHtCents;
  const syncCents = input.syncIncluded ? SYNC_OPTION_CENTS : 0;

  const listMonthlyCents = plan.monthlyHtCents + lauraCents + syncCents;
  const netMonthlyCents = input.cadence === "MONTHLY"
    ? Math.round(listMonthlyCents * (1 - discount / 100))
    : listMonthlyCents;

  // Per Fodé brief p. 12 & 18: annual deals count at catalog MRR despite free months;
  // monthly deals discounted > 10% reduce commission proportionally.
  const mrrSignedEur = Math.round((listMonthlyCents / 100) * 100) / 100;
  const commissionDiscountFactor =
    input.cadence === "MONTHLY" && discount > 10 ? Math.round((1 - discount / 100) * 10000) / 10000 : 1;

  let freeMonths = 0;
  let annualTotalHtCents: number | null = null;
  let todayHtCents = netMonthlyCents;

  if (input.cadence === "ANNUAL_1X") {
    freeMonths = 2;
    annualTotalHtCents = listMonthlyCents * 10;
    todayHtCents = annualTotalHtCents;
  } else if (input.cadence === "ANNUAL_3X") {
    freeMonths = 1;
    annualTotalHtCents = listMonthlyCents * 11;
    todayHtCents = Math.round(annualTotalHtCents / 3);
  }

  const todayVatCents = Math.round(todayHtCents * VAT_RATE);
  const todayTtcCents = todayHtCents + todayVatCents;
  const freeWebsiteIncluded = input.cadence !== "MONTHLY" && plan.freeWebsiteOnAnnual;

  return {
    plan,
    lauraCents,
    syncCents,
    listMonthlyCents,
    netMonthlyCents,
    mrrSignedEur,
    freeMonths,
    annualTotalHtCents,
    todayHtCents,
    todayVatCents,
    todayTtcCents,
    freeWebsiteIncluded,
    commissionDiscountFactor,
  };
}

export function formatEurCents(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`;
}
