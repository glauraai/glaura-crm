import { z } from "zod";
import { prisma } from "@/lib/db";
import { calculateOfferPricing, formatEurCents } from "@/lib/pricing/catalog";
import { checkUserAiBudget, runCachedHaikuJson } from "./llm";
import type { BillingCadence } from "@/generated/prisma/enums";

export type CraftOfferRecommendation = {
  planCode: "essentiel_v3" | "salon_solo" | "salon_v3";
  cadence: BillingCadence;
  lauraChannels: "none" | "instagram" | "whatsapp" | "both" | "phone" | "full" | "marketing_only";
  syncIncluded: boolean;
  upsellOptions: string[];
  rationale: string;
};

export function recommendCraftOffer(input: {
  salonSizeHint?: string | null;
  hasPlanity?: boolean;
  hasTreatwell?: boolean;
  mainPain?: string | null;
  productsPitched?: string[];
  salesAngle?: string | null;
}): CraftOfferRecommendation {
  const sizeText = (input.salonSizeHint ?? "").toLowerCase();
  const painText = `${input.mainPain ?? ""} ${input.salesAngle ?? ""} ${(input.productsPitched ?? []).join(" ")}`.toLowerCase();

  let planCode: "essentiel_v3" | "salon_solo" | "salon_v3" = "salon_solo";
  if (sizeText.includes("indépendant") || sizeText.includes("auto-entrepreneur") || sizeText.includes("domicile")) {
    planCode = "essentiel_v3";
  } else if (
    sizeText.includes("équipe") ||
    sizeText.includes("salarié") ||
    /\b([2-9]|10)\b/.test(sizeText)
  ) {
    planCode = "salon_v3";
  }

  const syncIncluded = Boolean(input.hasPlanity && input.hasTreatwell) || painText.includes("synchro");

  let lauraChannels: CraftOfferRecommendation["lauraChannels"] = "none";
  if (painText.includes("téléphone") || painText.includes("appel")) {
    lauraChannels = painText.includes("insta") || painText.includes("whatsapp") ? "full" : "phone";
  } else if (painText.includes("insta") && painText.includes("whatsapp")) {
    lauraChannels = "both";
  } else if (painText.includes("laura") || painText.includes("hors horaires") || painText.includes("dm")) {
    lauraChannels = "instagram";
  } else if (painText.includes("whatsapp")) {
    lauraChannels = "whatsapp";
  }

  const cadence: BillingCadence = planCode === "essentiel_v3" ? "MONTHLY" : "ANNUAL_1X";
  const upsellOptions: string[] = [];
  if (lauraChannels === "none") upsellOptions.push("Laura IA Instagram (59 € HT/mois) pour répondre 24h/24 aux DM");
  if (!syncIncluded && (input.hasPlanity || input.hasTreatwell)) {
    upsellOptions.push("Synchronisation Planity / Treatwell (19 € HT/mois)");
  }
  if (planCode !== "essentiel_v3") {
    upsellOptions.push("Site personnalisé (valeur 500 €) offert sur la formule annuelle");
  }

  return {
    planCode,
    cadence,
    lauraChannels,
    syncIncluded,
    upsellOptions,
    rationale: `Offre recommandée selon le profil (${planCode === "salon_v3" ? "équipe" : planCode === "salon_solo" ? "salon solo" : "indépendante"})${syncIncluded ? " avec synchro double agenda" : ""}${lauraChannels !== "none" ? ` et option Laura (${lauraChannels})` : ""}.`,
  };
}

const craftEmailSchema = z.object({
  subject: z.string().min(5),
  body: z.string().min(20),
  toVerify: z.array(z.string()).default([]),
});

const CRAFT_SYSTEM_PROMPT = `Tu es CRAFT, l'agent IA de devis et proposition commerciale de Glaura.
Règles :
- Tu rédiges un email de récapitulatif personnalisé post-RDV en français ("vous"), clair, direct et chaleureux.
- Tu reprends les montants exacts HT fournis (ne modifie aucun tarif), mentionnes le site personnalisé offert en annuel si applicable, et laisses un emplacement [LIEN_ABONNEMENT_STRIPE] à confirmer par le commercial.
- Réponds UNIQUEMENT en JSON valide : { "subject": string, "body": string, "toVerify": string[] }.`;

export async function generateCraftProposalForSalon(salonId: string, requestedById?: string | null) {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    include: {
      prospect: { select: { planityUrl: true, treatwellUrl: true } },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      transcripts: { orderBy: { occurredAt: "desc" }, take: 1, select: { summary: true } },
    },
  });
  if (!salon) throw new Error("Salon introuvable.");

  const opp = salon.opportunities[0] ?? null;
  const qual = (opp?.qualificationJson ?? {}) as Record<string, unknown>;
  const rec = recommendCraftOffer({
    salonSizeHint: typeof qual.salonSize === "string" ? qual.salonSize : null,
    hasPlanity: salon.bookingTool === "PLANITY" || Boolean(salon.prospect?.planityUrl),
    hasTreatwell: salon.bookingTool === "TREATWELL" || Boolean(salon.prospect?.treatwellUrl),
    mainPain: typeof qual.mainPain === "string" ? qual.mainPain : salon.notes,
    productsPitched: Array.isArray(qual.productsPitched) ? qual.productsPitched.map(String) : [],
    salesAngle: typeof qual.salesAngle === "string" ? qual.salesAngle : salon.gtmAngle,
  });

  const pricing = calculateOfferPricing({
    planCode: rec.planCode,
    cadence: rec.cadence,
    lauraChannels: rec.lauraChannels === "none" ? null : rec.lauraChannels,
    syncIncluded: rec.syncIncluded,
    discountPercent: 0,
  });

  const contactGreeting = salon.contactName ? `Bonjour ${salon.contactName},` : "Bonjour,";
  let subject = `Votre proposition Glaura pour ${salon.name}`;
  let body = `${contactGreeting}\n\nMerci pour notre échange ! Voici le récapitulatif de la formule adaptée à ${salon.name} :\n- Formule : ${pricing.plan.name} (${formatEurCents(pricing.plan.monthlyHtCents)} HT/mois)\n${pricing.lauraCents > 0 ? `- Option Laura IA (${rec.lauraChannels}) : ${formatEurCents(pricing.lauraCents)} HT/mois\n` : ""}${pricing.syncCents > 0 ? `- Synchronisation Planity / Treatwell : ${formatEurCents(pricing.syncCents)} HT/mois\n` : ""}- Total catalogue : ${formatEurCents(pricing.listMonthlyCents)} HT/mois${pricing.freeMonths > 0 ? ` (${pricing.freeMonths} mois offert(s) en annuel)` : ""}${pricing.freeWebsiteIncluded ? "\n- Bonus inclus : site web personnalisé (valeur 500 €) offert" : ""}\n\nVoici votre lien d’abonnement sécurisé : [LIEN_ABONNEMENT_STRIPE]\n\nJe reste disponible si vous avez la moindre question.\nBien cordialement,`;
  let toVerify = ["Générer le lien de paiement Stripe sur la fiche salon avant envoi", "Vérifier le nombre exact de praticiens et les options retenues"];
  let usage: unknown = undefined;

  const assigneeId = requestedById ?? opp?.ownerId ?? salon.assignedToId;
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const budget = await checkUserAiBudget(assigneeId);
    if (budget.allowed) {
      try {
        const llm = await runCachedHaikuJson({
          systemPrompt: CRAFT_SYSTEM_PROMPT,
          userPayload: {
            salonName: salon.name,
            contactName: salon.contactName,
            plan: pricing.plan.name,
            cadence: rec.cadence,
            listMonthlyEur: pricing.listMonthlyCents / 100,
            todayHtEur: pricing.todayHtCents / 100,
            freeMonths: pricing.freeMonths,
            freeWebsiteIncluded: pricing.freeWebsiteIncluded,
            upsellOptions: rec.upsellOptions,
            qualification: qual,
            lastSummary: salon.transcripts[0]?.summary ?? null,
          },
          parse: (raw) => craftEmailSchema.parse(raw),
          maxTokens: 700,
        });
        subject = llm.output.subject;
        body = llm.output.body;
        if (llm.output.toVerify.length) toVerify = llm.output.toVerify;
        usage = llm.usage;
      } catch (err) {
        console.error("[CRAFT] LLM fallback used:", err);
      }
    }
  }

  const jPlus2 = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    // 1. Draft quote suggestion
    await tx.agentSuggestion.create({
      data: {
        agent: "CRAFT",
        kind: "QUOTE_DRAFT",
        targetType: "QUOTE",
        targetId: opp?.id ?? salon.id,
        salonId: salon.id,
        opportunityId: opp?.id ?? null,
        assignedToId: assigneeId,
        title: `Devis CRAFT · ${salon.name} (${formatEurCents(pricing.listMonthlyCents)} HT/m)`,
        proposedPayload: {
          planCode: rec.planCode,
          label: pricing.plan.name,
          cadence: rec.cadence,
          lauraChannels: rec.lauraChannels === "none" ? null : rec.lauraChannels,
          syncIncluded: rec.syncIncluded,
          listMonthlyCents: pricing.listMonthlyCents,
          netMonthlyCents: pricing.netMonthlyCents,
          lauraCents: pricing.lauraCents,
          syncCents: pricing.syncCents,
          freeMonths: pricing.freeMonths,
          freeWebsiteIncluded: pricing.freeWebsiteIncluded,
          upsellOptions: rec.upsellOptions,
          rationale: rec.rationale,
          followUpTaskDate: jPlus2,
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        generationReport: {
          actionsTaken: ["Calcul de la grille V3 (24/11/2026)", "Préparation du brouillon de devis + tâche relance J+2"],
          assumptions: [rec.rationale],
          toVerify,
          sources: ["Catalogue Tarifs V3", "Qualification ECHO"],
          ...(usage ? { usage } : {}),
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      },
    });

    // 2. Personalized recap email draft suggestion
    await tx.agentSuggestion.create({
      data: {
        agent: "CRAFT",
        kind: "EMAIL_DRAFT",
        targetType: "SALON",
        targetId: salon.id,
        salonId: salon.id,
        opportunityId: opp?.id ?? null,
        assignedToId: assigneeId,
        title: `Email récapitulatif CRAFT · ${salon.name}`,
        proposedPayload: {
          to: salon.contactEmail ?? "",
          subject,
          body,
          upsellOptions: rec.upsellOptions,
          nextStep: `Relancer ${salon.name} sur la proposition envoyée`,
          nextStepDate: jPlus2,
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        generationReport: {
          actionsTaken: ["Rédaction de l’email récapitulatif personnalisé"],
          assumptions: ["Lien de paiement Stripe à insérer après validation du devis"],
          toVerify,
          sources: ["Catalogue Tarifs V3", "Qualification ECHO"],
        } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      },
    });
  });

  return { recommendation: rec, pricing, subject };
}
