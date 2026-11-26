export const AI_SPECIALTY_LABEL: Record<string, string> = {
  both: "Ongles & Beauté",
  nails: "Ongles",
  beauty: "Beauté",
  hair: "Coiffure",
  barber: "Barbier",
  spa: "Spa / Bien-être",
  other: "Autre",
  unknown: "Inconnu",
};

export const BEAUTY_NAILS_SPECIALTIES = ["both", "nails", "beauty"] as const;

export const AI_OWNERSHIP_LABEL: Record<string, string> = {
  independent_indicated: "Indépendant",
  chain_or_franchise: "Chaîne / Franchise",
  unknown: "Propriétaire non vérifié",
};

export const COMPANY_MATCH_LABEL: Record<string, string> = {
  VERIFIED: "Vérifiée",
  CANDIDATE: "À confirmer",
  UNRESOLVED: "Non identifiée",
  EXCLUDED: "Exclue",
};

export const REVENUE_STATUS_LABEL: Record<string, string> = {
  PUBLISHED: "CA publié",
  CONFIDENTIAL: "Comptes confidentiels",
  UNAVAILABLE: "CA non publié",
};

export function aiScoreBadgeStyle(score: number | null | undefined): string {
  if (score == null) return "bg-slate-100 text-slate-600";
  if (score >= 80) return "bg-emerald-100 text-emerald-800";
  if (score >= 60) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

export function formatRevenueEur(amount: number | null | undefined, year?: number | null): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  let formatted: string;
  if (amount >= 1_000_000) {
    formatted = `${(amount / 1_000_000).toFixed(2).replace(".", ",")} M€`;
  } else if (amount >= 1_000) {
    formatted = `${Math.round(amount / 1_000).toLocaleString("fr-FR")} k€`;
  } else {
    formatted = `${Math.round(amount).toLocaleString("fr-FR")} €`;
  }
  return year ? `${formatted} (${year})` : formatted;
}

export function annuaireEntreprisesUrl(siret: string | null | undefined, siren: string | null | undefined): string | null {
  if (siret && /^\d{14}$/.test(siret)) {
    return `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}`;
  }
  if (siren && /^\d{9}$/.test(siren)) {
    return `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;
  }
  return null;
}

export type ProspectEnrichmentPayload = {
  id: string;
  aiScore: number | null;
  aiSpecialty: string;
  aiOwnership: string;
  aiSummary: string | null;
  legalEntity: string | null;
  siren: string | null;
  siret: string | null;
  activeSites: number | null;
  companyMatchStatus: string | null;
  revenueEur: number | null;
  revenueYear: number | null;
  revenueStatus: string | null;
  filingUrl: string | null;
};

function cleanStr(value: unknown, maxLen = 400): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

function cleanHttpsUrl(value: unknown): string | null {
  const s = cleanStr(value, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseProspectEnrichmentRow(raw: unknown): ProspectEnrichmentPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = cleanStr(obj.id, 100);
  if (!id) return null;

  const rawScore = typeof obj.aiScore === "number" && Number.isFinite(obj.aiScore) ? obj.aiScore : null;
  const aiScore = rawScore == null ? null : Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;

  const rawSpec = cleanStr(obj.aiSpecialty, 40);
  const aiSpecialty = rawSpec && rawSpec in AI_SPECIALTY_LABEL ? rawSpec : "unknown";

  const rawOwn = cleanStr(obj.aiOwnership, 40);
  const aiOwnership = rawOwn && rawOwn in AI_OWNERSHIP_LABEL ? rawOwn : "unknown";

  const rawSiren = cleanStr(obj.siren, 20);
  const siren = rawSiren && /^\d{9}$/.test(rawSiren) ? rawSiren : null;

  const rawSiret = cleanStr(obj.siret, 20);
  const siret = rawSiret && /^\d{14}$/.test(rawSiret) && (!siren || rawSiret.startsWith(siren)) ? rawSiret : null;

  const rawStatus = cleanStr(obj.companyMatchStatus, 30);
  const companyMatchStatus = rawStatus && rawStatus in COMPANY_MATCH_LABEL ? rawStatus : null;

  const rawRev = typeof obj.revenueEur === "number" && Number.isFinite(obj.revenueEur) && obj.revenueEur > 0 ? Math.round(obj.revenueEur) : null;
  const rawYear = typeof obj.revenueYear === "number" && Number.isInteger(obj.revenueYear) && obj.revenueYear >= 2000 && obj.revenueYear <= 2100 ? obj.revenueYear : null;
  const rawRevStatus = cleanStr(obj.revenueStatus, 30);
  const revenueStatus = rawRevStatus && rawRevStatus in REVENUE_STATUS_LABEL ? rawRevStatus : null;

  const rawSites = typeof obj.activeSites === "number" && Number.isInteger(obj.activeSites) && obj.activeSites >= 0 ? obj.activeSites : null;

  return {
    id,
    aiScore,
    aiSpecialty,
    aiOwnership,
    aiSummary: cleanStr(obj.aiSummary, 600),
    legalEntity: cleanStr(obj.legalEntity, 200),
    siren,
    siret,
    activeSites: rawSites,
    companyMatchStatus,
    revenueEur: rawRev,
    revenueYear: rawYear,
    revenueStatus,
    filingUrl: cleanHttpsUrl(obj.filingUrl),
  };
}
