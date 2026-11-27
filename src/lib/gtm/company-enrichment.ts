export type CompanyEnrichmentResult = {
  companyMatchStatus: "VERIFIED" | "CANDIDATE" | "UNRESOLVED";
  legalEntity: string | null;
  siren: string | null;
  siret: string | null;
  nafCode: string | null;
  legalForm: string | null;
  isSoleProprietor: boolean;
  activeSites: number | null;
  isChainOrFranchise: boolean;
  staffEstimate: number | null;
  trancheEffectif: string | null;
  createdDate: string | null;
  isRecentOpening: boolean;
  revenueEur: number | null;
  netResultEur: number | null;
  revenueYear: number | null;
  revenueStatus: "PUBLISHED" | "CONFIDENTIAL" | "UNAVAILABLE";
  filingUrl: string | null;
};

const BEAUTY_NAF_PREFIXES = ["96.02", "96.04", "47.75", "86.90", "96.09"];

const KNOWN_CHAINS = [
  "franck provost",
  "jean louis david",
  "saint algue",
  "fabio salsa",
  "dessange",
  "camille albane",
  "mod's hair",
  "mod s hair",
  "yves rocher",
  "body minute",
  "bodyminute",
  "nocibe",
  "sephora",
  "marionnaud",
  "tchip",
  "coiff&co",
  "coiff & co",
  "pascal coste",
  "vog coiffure",
  "eric stipa",
  "atelier intermede",
  "intermede",
  "guinot",
  "mary cohr",
  "carlota",
  "l'onglerie",
  "benefit",
  "kiko",
  "passage bleu",
  "citron vert",
  "point soleil",
  "depil tech",
  "lazeo",
];

// Official INSEE tranche_effectif_salarie -> approximate practitioner/employee count
const TRANCHE_TO_STAFF: Record<string, number> = {
  "00": 1,
  "01": 2,
  "02": 4,
  "03": 7,
  "11": 12,
  "12": 25,
  "21": 60,
};

const STOP_WORDS = new Set([
  "sarl",
  "sas",
  "sasu",
  "eurl",
  "ei",
  "ets",
  "salon",
  "institut",
  "beaute",
  "coiffure",
  "coiffeur",
  "paris",
  "studio",
  "maison",
  "atelier",
  "bar",
  "spa",
  "ongles",
  "nail",
  "nails",
  "beauty",
  "hair",
  "les",
  "des",
  "aux",
  "par",
  "chez",
]);

export function normalizeCompanyText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isKnownChainName(name: string): boolean {
  const norm = normalizeCompanyText(name);
  return KNOWN_CHAINS.some((c) => norm.includes(normalizeCompanyText(c)));
}

export function staffFromInseeTranche(tranche: string | null | undefined, isSoleProp: boolean): number | null {
  if (tranche && tranche in TRANCHE_TO_STAFF) return TRANCHE_TO_STAFF[tranche];
  if (isSoleProp) return 1;
  return null;
}

export function extractLatestFinance(
  finances: Record<string, { ca?: number | null; resultat_net?: number | null }> | null | undefined,
): { revenueEur: number | null; netResultEur: number | null; revenueYear: number | null } {
  if (!finances || typeof finances !== "object") {
    return { revenueEur: null, netResultEur: null, revenueYear: null };
  }
  const years = Object.keys(finances)
    .filter((y) => /^\d{4}$/.test(y))
    .sort((a, b) => Number(b) - Number(a));
  for (const year of years) {
    const entry = finances[year];
    if (entry && typeof entry.ca === "number" && Number.isFinite(entry.ca) && entry.ca > 0) {
      return {
        revenueEur: Math.round(entry.ca),
        netResultEur:
          typeof entry.resultat_net === "number" && Number.isFinite(entry.resultat_net)
            ? Math.round(entry.resultat_net)
            : null,
        revenueYear: Number(year),
      };
    }
  }
  return { revenueEur: null, netResultEur: null, revenueYear: null };
}

function tokenOverlapScore(a: string, b: string): number {
  const tokensA = normalizeCompanyText(a)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  const tokensB = new Set(
    normalizeCompanyText(b)
      .split(" ")
      .filter((t) => t.length >= 2),
  );
  if (tokensA.length === 0) {
    const fallbackA = normalizeCompanyText(a).split(" ").filter((t) => t.length >= 2);
    if (fallbackA.length === 0) return 0;
    const hits = fallbackA.filter((t) => tokensB.has(t)).length;
    return hits / fallbackA.length;
  }
  const hits = tokensA.filter((t) => tokensB.has(t)).length;
  return hits / tokensA.length;
}

type AnnuaireEtab = {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  nom_commercial?: string | null;
  liste_enseignes?: string[] | null;
  activite_principale?: string;
  tranche_effectif_salarie?: string | null;
  etat_administratif?: string;
};

type AnnuaireResult = {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  activite_principale?: string;
  nature_juridique?: string;
  tranche_effectif_salarie?: string | null;
  nombre_etablissements_ouverts?: number;
  date_creation?: string;
  etat_administratif?: string;
  finances?: Record<string, { ca?: number | null; resultat_net?: number | null }>;
  siege?: AnnuaireEtab;
  matching_etablissements?: AnnuaireEtab[];
};

export function pickBestAnnuaireMatch(
  input: { name: string; postalCode?: string | null; address?: string | null; siret?: string | null },
  results: AnnuaireResult[],
): { match: AnnuaireResult; etab: AnnuaireEtab | null; status: "VERIFIED" | "CANDIDATE" } | null {
  const pc = input.postalCode?.trim() ?? "";
  let best: { match: AnnuaireResult; etab: AnnuaireEtab | null; score: number } | null = null;

  for (const r of results) {
    if (r.etat_administratif && r.etat_administratif !== "A") continue;
    const etabs = [...(r.matching_etablissements ?? []), ...(r.siege ? [r.siege] : [])];
    const matchingEtab =
      (input.siret ? etabs.find((e) => e.siret === input.siret) : null) ??
      (pc ? etabs.find((e) => e.code_postal === pc && e.etat_administratif !== "F") : null) ??
      etabs.find((e) => e.etat_administratif !== "F") ??
      etabs[0] ??
      null;

    const namesToCompare = [
      r.nom_complet,
      r.nom_raison_sociale,
      matchingEtab?.nom_commercial,
      ...(matchingEtab?.liste_enseignes ?? []),
    ].filter((x): x is string => Boolean(x));

    const nameScore = Math.max(0, ...namesToCompare.map((n) => tokenOverlapScore(input.name, n)));
    const pcExact = Boolean(pc && matchingEtab?.code_postal === pc);
    const addrScore =
      input.address && matchingEtab?.adresse ? tokenOverlapScore(input.address, matchingEtab.adresse) : 0;
    const naf = matchingEtab?.activite_principale ?? r.activite_principale ?? "";
    const isBeautyNaf = BEAUTY_NAF_PREFIXES.some((p) => naf.startsWith(p));

    let total = nameScore * 55 + (pcExact ? 25 : 0) + addrScore * 15 + (isBeautyNaf ? 15 : 0);
    if (input.siret && matchingEtab?.siret === input.siret) total = 100;

    if (!best || total > best.score) {
      best = { match: r, etab: matchingEtab, score: total };
    }
  }

  if (!best || best.score < 50) return null;
  const status: "VERIFIED" | "CANDIDATE" = best.score >= 70 ? "VERIFIED" : "CANDIDATE";
  return { match: best.match, etab: best.etab, status };
}

async function fetchBodaccFiling(
  siren: string,
): Promise<{ status: "CONFIDENTIAL" | "UNAVAILABLE"; filingUrl: string | null; year: number | null }> {
  try {
    const where = encodeURIComponent(`registre="${siren}" AND familleavis="dpc"`);
    const url = `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=${where}&order_by=dateparution%20DESC&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { status: "UNAVAILABLE", filingUrl: null, year: null };
    const data = (await res.json()) as {
      results?: Array<{ id?: string; url_complete?: string; dateparution?: string }>;
    };
    const rec = data.results?.[0];
    if (!rec) return { status: "UNAVAILABLE", filingUrl: null, year: null };
    const yearMatch = rec.dateparution?.match(/^(\d{4})/);
    const filingUrl =
      rec.url_complete ??
      (rec.id
        ? `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${encodeURIComponent(rec.id)}`
        : `https://www.bodacc.fr/pages/annonces-commerciales/?q.registre=registre:${siren}`);
    return {
      status: "CONFIDENTIAL",
      filingUrl,
      year: yearMatch ? Number(yearMatch[1]) - 1 : null,
    };
  } catch {
    return { status: "UNAVAILABLE", filingUrl: null, year: null };
  }
}

export async function enrichCompanyFrance(
  input: {
    name: string;
    postalCode?: string | null;
    address?: string | null;
    siret?: string | null;
  },
  options?: { checkBodacc?: boolean; now?: Date },
): Promise<CompanyEnrichmentResult> {
  const now = options?.now ?? new Date();
  const knownChain = isKnownChainName(input.name);
  const query = input.siret?.trim() || `${input.name.trim()} ${input.postalCode?.trim() ?? ""}`.trim();
  const params = new URLSearchParams({
    q: query,
    per_page: "5",
    etat_administratif: "A",
  });
  if (input.postalCode && /^\d{5}$/.test(input.postalCode.trim())) {
    params.set("code_postal", input.postalCode.trim());
  }

  let results: AnnuaireResult[] = [];
  try {
    const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { results?: AnnuaireResult[] };
      results = json.results ?? [];
    }
  } catch {
    // Soft fail -> UNRESOLVED
  }

  // Fallback without postal code restriction if 0 results (e.g. siege in another CP)
  if (results.length === 0 && input.postalCode && !input.siret) {
    try {
      const p2 = new URLSearchParams({ q: input.name.trim(), per_page: "5", etat_administratif: "A" });
      const res2 = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${p2.toString()}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res2.ok) {
        const json2 = (await res2.json()) as { results?: AnnuaireResult[] };
        results = json2.results ?? [];
      }
    } catch {
      // Ignore
    }
  }

  const picked = pickBestAnnuaireMatch(input, results);
  if (!picked) {
    return {
      companyMatchStatus: "UNRESOLVED",
      legalEntity: null,
      siren: null,
      siret: null,
      nafCode: null,
      legalForm: null,
      isSoleProprietor: false,
      activeSites: null,
      isChainOrFranchise: knownChain,
      staffEstimate: null,
      trancheEffectif: null,
      createdDate: null,
      isRecentOpening: false,
      revenueEur: null,
      netResultEur: null,
      revenueYear: null,
      revenueStatus: "UNAVAILABLE",
      filingUrl: null,
    };
  }

  const { match, etab, status } = picked;
  const siren = match.siren ?? null;
  const siret = etab?.siret ?? match.siege?.siret ?? null;
  const activeSites = typeof match.nombre_etablissements_ouverts === "number" ? match.nombre_etablissements_ouverts : null;
  const legalForm = match.nature_juridique ?? null;
  const isSoleProprietor = legalForm === "1000";
  const tranche = etab?.tranche_effectif_salarie ?? match.tranche_effectif_salarie ?? null;
  const staffEstimate = staffFromInseeTranche(tranche, isSoleProprietor);
  const createdDate = match.date_creation ?? null;
  const isRecentOpening = Boolean(
    createdDate &&
      !Number.isNaN(Date.parse(createdDate)) &&
      now.getTime() - Date.parse(createdDate) <= 18 * 30 * 24 * 60 * 60 * 1000,
  );

  const fin = extractLatestFinance(match.finances);
  let revenueStatus: "PUBLISHED" | "CONFIDENTIAL" | "UNAVAILABLE" =
    fin.revenueEur != null ? "PUBLISHED" : "UNAVAILABLE";
  let filingUrl: string | null =
    siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}` : null;
  let revenueYear = fin.revenueYear;

  if (revenueStatus !== "PUBLISHED" && siren && !isSoleProprietor && (options?.checkBodacc ?? true)) {
    const bodacc = await fetchBodaccFiling(siren);
    if (bodacc.filingUrl) {
      revenueStatus = bodacc.status;
      filingUrl = bodacc.filingUrl;
      if (revenueYear == null) revenueYear = bodacc.year;
    }
  }

  return {
    companyMatchStatus: status,
    legalEntity: match.nom_complet ?? match.nom_raison_sociale ?? null,
    siren,
    siret,
    nafCode: etab?.activite_principale ?? match.activite_principale ?? null,
    legalForm,
    isSoleProprietor,
    activeSites,
    isChainOrFranchise: knownChain || (activeSites != null && activeSites >= 5),
    staffEstimate,
    trancheEffectif: tranche,
    createdDate,
    isRecentOpening,
    revenueEur: fin.revenueEur,
    netResultEur: fin.netResultEur,
    revenueYear,
    revenueStatus,
    filingUrl,
  };
}
