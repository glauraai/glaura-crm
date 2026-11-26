import type { OpportunityStage, SalonStatus } from "@/generated/prisma/enums";

export const MONTHLY_CLAIM_CAP = 120;

export type PipelinePhase = "Prospection" | "Rendez-vous" | "Conversion" | "Sortie";

export type StageMeta = {
  stage: OpportunityStage;
  label: string;
  phase: PipelinePhase;
  badgeClass: string;
  triggerHint: string;
};

export const OPPORTUNITY_STAGES: readonly StageMeta[] = [
  { stage: "A_CONTACTER", label: "À contacter", phase: "Prospection", badgeClass: "bg-slate-100 text-slate-700", triggerHint: "Compte ajouté au portefeuille" },
  { stage: "CONTACTE", label: "Contacté", phase: "Prospection", badgeClass: "bg-sky-100 text-sky-700", triggerHint: "Premier appel Allo ou message" },
  { stage: "R1_PROGRAMME", label: "R1 programmé", phase: "Rendez-vous", badgeClass: "bg-indigo-100 text-indigo-700", triggerHint: "Événement créé dans l’agenda" },
  { stage: "R1_EFFECTUE", label: "R1 effectué", phase: "Rendez-vous", badgeClass: "bg-violet-100 text-violet-700", triggerHint: "Transcription reçue ou validation" },
  { stage: "NO_SHOW", label: "No show", phase: "Rendez-vous", badgeClass: "bg-orange-100 text-orange-800", triggerHint: "RDV passé sans échange" },
  { stage: "A_RELANCER", label: "À relancer", phase: "Rendez-vous", badgeClass: "bg-amber-100 text-amber-800", triggerHint: "No show ou prochaine étape relance" },
  { stage: "ANNULE", label: "Annulé", phase: "Rendez-vous", badgeClass: "bg-slate-200 text-slate-600", triggerHint: "RDV annulé dans l’agenda" },
  { stage: "DEVIS_ENVOYE", label: "Devis envoyé", phase: "Conversion", badgeClass: "bg-cyan-100 text-cyan-800", triggerHint: "Offre / lien envoyé au salon" },
  { stage: "ABONNE", label: "Abonné", phase: "Conversion", badgeClass: "bg-teal-100 text-teal-800", triggerHint: "Abonnement créé côté Glaura" },
  { stage: "COMPTE_ACTIVE", label: "Compte activé", phase: "Conversion", badgeClass: "bg-lime-100 text-lime-800", triggerHint: "Activation détectée dans le produit" },
  { stage: "SIGNE", label: "Signé", phase: "Conversion", badgeClass: "bg-emerald-100 text-emerald-800", triggerHint: "Contrat ou devis accepté" },
  { stage: "ENCAISSE", label: "Encaissé", phase: "Conversion", badgeClass: "bg-emerald-600 text-white", triggerHint: "Premier paiement Stripe reçu" },
  { stage: "PERDU", label: "Perdu", phase: "Sortie", badgeClass: "bg-rose-100 text-rose-700", triggerHint: "Motif obligatoire" },
] as const;

export const OPPORTUNITY_STAGE_ORDER: OpportunityStage[] = OPPORTUNITY_STAGES.map((s) => s.stage);

export const STAGE_META_MAP: Record<OpportunityStage, StageMeta> = Object.fromEntries(
  OPPORTUNITY_STAGES.map((m) => [m.stage, m]),
) as Record<OpportunityStage, StageMeta>;

export function isValidStageTransitionInput(
  nextStage: OpportunityStage,
  lossReason?: string | null,
): { ok: true } | { ok: false; error: string } {
  if (nextStage === "PERDU" && (!lossReason || !lossReason.trim())) {
    return { ok: false, error: "Un motif de perte est obligatoire." };
  }
  return { ok: true };
}

export function mapSalonStatusToStage(status: SalonStatus): OpportunityStage {
  switch (status) {
    case "A_VISITER":
      return "A_CONTACTER";
    case "VISITE_FAITE":
    case "INTERESSE":
      return "R1_EFFECTUE";
    case "A_RELANCER":
      return "A_RELANCER";
    case "PAS_INTERESSE":
      return "PERDU";
    case "SIGNE":
      return "SIGNE";
  }
}

export function mapStageToSalonStatus(stage: OpportunityStage): SalonStatus {
  switch (stage) {
    case "A_CONTACTER":
    case "CONTACTE":
    case "R1_PROGRAMME":
      return "A_VISITER";
    case "R1_EFFECTUE":
    case "DEVIS_ENVOYE":
      return "INTERESSE";
    case "NO_SHOW":
    case "A_RELANCER":
    case "ANNULE":
      return "A_RELANCER";
    case "ABONNE":
    case "COMPTE_ACTIVE":
    case "SIGNE":
    case "ENCAISSE":
      return "SIGNE";
    case "PERDU":
      return "PAS_INTERESSE";
  }
}

export function remainingMonthlyClaims(claimedThisMonth: number): number {
  return Math.max(0, MONTHLY_CLAIM_CAP - Math.max(0, claimedThisMonth));
}

export function nextRoundRobinUserId(activeRepIds: readonly string[], lastAssignedId: string | null): string | null {
  if (activeRepIds.length === 0) return null;
  if (!lastAssignedId) return activeRepIds[0];
  const idx = activeRepIds.indexOf(lastAssignedId);
  if (idx === -1) return activeRepIds[0];
  return activeRepIds[(idx + 1) % activeRepIds.length];
}

export function startOfCurrentParisMonth(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? String(now.getUTCFullYear());
  const month = parts.find((p) => p.type === "month")?.value ?? String(now.getUTCMonth() + 1).padStart(2, "0");
  return new Date(`${year}-${month}-01T00:00:00.000Z`);
}
