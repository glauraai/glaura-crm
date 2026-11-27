export type ParsedLeadNotes = {
  staffCount: number | null;
  tiktokHandle: string | null;
  hasPlanityHint: boolean;
  hasTreatwellHint: boolean;
  hasOtherToolHint: boolean;
  decisionMakerName: string | null;
  isFormerClient: boolean;
  specialtyHint: string | null;
  ratingHint: number | null;
  reviewCountHint: number | null;
  sellsProductsHint: boolean;
};

function cleanLineValue(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().replace(/^[:\-\s]+/, "").trim();
  return v && !/^(non[_\s-]?d[ée]fini|inconnu|aucun|n\/a|-+)$/i.test(v) ? v : null;
}

/**
 * Extracts structured qualification & GTM 1 bis signals hidden in imported CSV notes
 * (e.g. "Effectif : 3", "TikTok : https://...", "Logiciel de réservation : Treatwell",
 * "Gérant : ...", "Statut client : Ancien client", "4,7/5, 2529 avis").
 */
export function parseLeadNotes(notes: string | null | undefined): ParsedLeadNotes {
  if (!notes?.trim()) {
    return {
      staffCount: null,
      tiktokHandle: null,
      hasPlanityHint: false,
      hasTreatwellHint: false,
      hasOtherToolHint: false,
      decisionMakerName: null,
      isFormerClient: false,
      specialtyHint: null,
      ratingHint: null,
      reviewCountHint: null,
      sellsProductsHint: false,
    };
  }

  // Staff / effectif
  let staffCount: number | null = null;
  const effectifMatch = notes.match(/effectif\s*:\s*(\d{1,3})/i) ?? notes.match(/(\d{1,2})\s*(?:praticien|salari[ée]|employ[ée]|poste|agenda)/i);
  if (effectifMatch) {
    const n = Number(effectifMatch[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 200) staffCount = n;
  }

  // TikTok handle
  let tiktokHandle: string | null = null;
  const tiktokMatch = notes.match(/tiktok\.com\/@([a-z0-9._-]+)/i) ?? notes.match(/tiktok\s*:\s*@?([a-z0-9._-]{2,})/i);
  if (tiktokMatch) {
    tiktokHandle = tiktokMatch[1].replace(/\/+$/, "");
  }

  // Booking tools
  const lower = notes.toLowerCase();
  const hasPlanityHint = /\bplanity\b/.test(lower);
  const hasTreatwellHint = /\btreatwell\b/.test(lower);
  const hasOtherToolHint = /\b(booksy|fresha|acuity|kiute|flexy|kalendes|wavy|timify|doctolib)\b/.test(lower);

  // Decision maker name
  const gerantMatch = notes.match(/(?:g[ée]rant(?:e)?|dirigeant(?:e)?|responsable)\s*:\s*([^\n]+)/i);
  const decisionMakerName = cleanLineValue(gerantMatch?.[1]);

  // Former client
  const isFormerClient = /ancien\s+client/i.test(notes);

  // Specialty ("Pôle : Esthétique")
  const poleMatch = notes.match(/p[ôo]le\s*:\s*([^\n]+)/i);
  const specialtyHint = cleanLineValue(poleMatch?.[1]);

  // Embedded rating / review count (e.g. "4,7/5, 2529 avis")
  let ratingHint: number | null = null;
  const ratingMatch = notes.match(/([0-5][.,]\d)\s*\/\s*5/);
  if (ratingMatch) {
    const r = Number(ratingMatch[1].replace(",", "."));
    if (Number.isFinite(r) && r >= 1 && r <= 5) ratingHint = r;
  }

  let reviewCountHint: number | null = null;
  const reviewsMatch = notes.match(/(\d[\d\s]{0,5})\s*avis/i);
  if (reviewsMatch) {
    const rc = Number(reviewsMatch[1].replace(/\s+/g, ""));
    if (Number.isInteger(rc) && rc >= 0) reviewCountHint = rc;
  }

  const sellsProductsHint = /\b(e-?shop|boutique|vente de produits|cosm[ée]tiques)\b/i.test(notes);

  return {
    staffCount,
    tiktokHandle,
    hasPlanityHint,
    hasTreatwellHint,
    hasOtherToolHint,
    decisionMakerName,
    isFormerClient,
    specialtyHint,
    ratingHint,
    reviewCountHint,
    sellsProductsHint,
  };
}
