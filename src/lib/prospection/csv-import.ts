// CSV lead import — pure helpers shared by the browser preview and the server
// action (no Prisma, no Node APIs). The contract is "never fail": any file a
// salesperson exports from Excel, Google Sheets, Airtable, Planity… must import.
//  - any encoding Excel produces (UTF-8 with/without BOM, Windows-1252)
//  - any delimiter (, ; tab |), quoted cells, embedded newlines, ragged rows
//  - any header wording (FR/EN synonyms), or no header row at all
//  - a row is never rejected: a missing name falls back to another field, and
//    every column we could not map is kept in the notes.

import { normalizeInstagramHandle } from "@/lib/instagram";
import type { Metier } from "@/generated/prisma/enums";

export const LEAD_FIELDS = [
  "name", "address", "postalCode", "city", "phone", "email", "instagram",
  "website", "bookingUrl", "contactName", "metier", "rating", "reviewCount", "notes",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const LEAD_FIELD_LABEL: Record<LeadField, string> = {
  name: "Nom du salon", address: "Adresse", postalCode: "Code postal", city: "Ville",
  phone: "Téléphone", email: "E-mail", instagram: "Instagram", website: "Site web",
  bookingUrl: "Lien Planity / Treatwell", contactName: "Contact", metier: "Métier",
  rating: "Note (/5)", reviewCount: "Nombre d’avis", notes: "Notes",
};

/** Column index → field, or null for "keep in notes". */
export type ColumnMapping = (LeadField | null)[];

export type ParsedCsv = { headers: string[]; rows: string[][]; hasHeader: boolean };

export type ImportedLead = {
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  website: string | null;
  planityUrl: string | null;
  treatwellUrl: string | null;
  contactName: string | null;
  metiers: Metier[];
  rating: number | null;
  reviewCount: number;
  notes: string | null;
};

export const MAX_IMPORT_ROWS = 10_000;
export const IMPORT_BATCH_SIZE = 500;

// ── Decoding ─────────────────────────────────────────────────────

/** UTF-8 when valid, else Windows-1252 (what French Excel saves as "CSV"). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

// ── Parsing ──────────────────────────────────────────────────────

const DELIMITERS = [",", ";", "\t", "|"] as const;

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20_000);
  let best: string = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = splitRecords(sample, d).slice(0, 20).filter(r => r.some(c => c.trim())).map(r => r.length);
    if (!counts.length) continue;
    // Prefer the delimiter that yields several columns consistently.
    const modal = mode(counts);
    const consistency = counts.filter(c => c === modal).length / counts.length;
    const score = modal > 1 ? modal * consistency : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function mode(values: number[]): number {
  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/** RFC 4180 tokenizer, lenient: stray quotes inside unquoted cells are kept. */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let atCellStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && atCellStart) { quoted = true; atCellStart = false; continue; }
    if (ch === delimiter) { record.push(cell); cell = ""; atCellStart = true; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(cell); records.push(record);
      record = []; cell = ""; atCellStart = true;
      continue;
    }
    cell += ch;
    atCellStart = false;
  }
  if (cell || record.length) { record.push(cell); records.push(record); }
  return records;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const records = splitRecords(clean, detectDelimiter(clean))
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(Boolean));
  if (!records.length) return { headers: [], rows: [], hasHeader: false };
  const width = Math.max(...records.map(r => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  const first = pad(records[0]);
  const hasHeader = looksLikeHeader(first, records.slice(1, 20).map(pad));
  const headers = hasHeader ? first.map((h, i) => h || `Colonne ${i + 1}`) : first.map((_, i) => `Colonne ${i + 1}`);
  return { headers, rows: (hasHeader ? records.slice(1) : records).map(pad), hasHeader };
}

function looksLikeHeader(first: string[], sample: string[][]): boolean {
  // A header row holds no emails, URLs, phones or postal codes.
  const typed = (cell: string) => { const f = sniffValue(cell); return f !== null && f !== "name" && f !== "address"; };
  if (first.some(typed)) return false;
  return first.some(h => headerField(h)) || sample.some(row => row.some(typed));
}

// ── Column matching ──────────────────────────────────────────────

export function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Normalized synonyms. Order inside a field does not matter; across fields the
// longest matching synonym wins ("nom du contact" → contactName, not name).
const SYNONYMS: Record<LeadField, string[]> = {
  name: ["nom", "nom du salon", "salon", "nom salon", "etablissement", "nom etablissement", "entreprise", "societe", "raison sociale", "enseigne", "nom commercial", "business", "business name", "company", "company name", "name", "title", "titre", "institut", "commerce"],
  address: ["adresse", "address", "rue", "adresse postale", "street", "voie", "adresse complete", "full address", "location", "localisation", "adresse 1", "address 1", "address line 1"],
  postalCode: ["code postal", "cp", "postal code", "postal", "zip", "zipcode", "zip code", "postcode", "code"],
  city: ["ville", "city", "commune", "localite", "town", "arrondissement"],
  phone: ["telephone", "tel", "phone", "mobile", "portable", "numero", "gsm", "phone number", "numero de telephone", "num", "telephone fixe", "telephone mobile", "tel portable", "whatsapp"],
  email: ["email", "e mail", "mail", "courriel", "adresse mail", "adresse email", "adresse e mail", "email address"],
  instagram: ["instagram", "insta", "ig", "compte instagram", "lien instagram", "instagram url", "handle"],
  website: ["site", "site web", "website", "url", "web", "site internet", "lien", "link"],
  bookingUrl: ["planity", "treatwell", "booksy", "fresha", "lien de reservation", "lien reservation", "booking", "booking url", "reservation", "url planity", "url treatwell", "lien planity", "lien treatwell"],
  contactName: ["contact", "nom du contact", "nom contact", "gerant", "gerante", "responsable", "proprietaire", "owner", "interlocuteur", "prenom", "contact name", "manager", "dirigeant", "prenom nom", "nom prenom", "decideur"],
  metier: ["metier", "categorie", "category", "type", "activite", "specialite", "secteur", "type de salon", "categories"],
  rating: ["note", "rating", "note google", "etoiles", "stars", "note moyenne", "average rating"],
  reviewCount: ["avis", "nombre d avis", "nb avis", "nombre avis", "reviews", "review count", "nb d avis", "reviews count", "nombre de commentaires"],
  notes: ["notes", "commentaire", "commentaires", "remarques", "remarque", "comments", "comment", "description", "infos", "informations", "observations", "memo"],
};

const SYNONYM_INDEX: { field: LeadField; synonym: string }[] = (Object.entries(SYNONYMS) as [LeadField, string[]][])
  .flatMap(([field, list]) => list.map(synonym => ({ field, synonym })))
  .sort((a, b) => b.synonym.length - a.synonym.length);

/** Best field for a header, with a confidence: 3 exact, 2 whole-word contained. */
function headerMatch(header: string): { field: LeadField; score: number } | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  const exact = SYNONYM_INDEX.find(s => s.synonym === h);
  if (exact) return { field: exact.field, score: 3 };
  const padded = ` ${h} `;
  const contained = SYNONYM_INDEX.find(s => s.synonym.length > 2 && padded.includes(` ${s.synonym} `));
  return contained ? { field: contained.field, score: 2 } : null;
}

function headerField(header: string): LeadField | null {
  return headerMatch(header)?.field ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const PHONE_RE = /^[+(]?[\d\s().\-/]{8,20}$/;

/** Field a single value most likely belongs to, from its shape alone. */
function sniffValue(raw: string): LeadField | null {
  const v = raw.trim().replace(/^'/, "");
  if (!v) return null;
  if (EMAIL_RE.test(v)) return "email";
  if (/instagram\.com|^@[\w.]{2,30}$/i.test(v)) return "instagram";
  if (/planity\.com|treatwell\.|booksy\.com|fresha\.com/i.test(v)) return "bookingUrl";
  if (URL_RE.test(v)) return "website";
  if (/^\d{5}$/.test(v)) return "postalCode";
  if (PHONE_RE.test(v) && v.replace(/\D/g, "").length >= 9) return "phone";
  if (/\d/.test(v) && /\b\d{5}\b/.test(v) && /[a-z]/i.test(v)) return "address";
  return /[a-z]/i.test(v) ? "name" : null;
}

function sniffColumn(values: string[]): LeadField | null {
  const filled = values.filter(v => v.trim()).slice(0, 50);
  if (!filled.length) return null;
  const freq = new Map<LeadField, number>();
  for (const v of filled) {
    const f = sniffValue(v);
    if (f) freq.set(f, (freq.get(f) ?? 0) + 1);
  }
  const [top] = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  if (!top || top[0] === "name" || top[1] / filled.length < 0.6) return null;
  return top[0];
}

const looksNumericRating = (values: string[]) => {
  const filled = values.filter(v => v.trim()).slice(0, 50);
  return filled.length > 0 && filled.every(v => { const n = parseNumber(v); return n !== null && n >= 0 && n <= 5; });
};

/**
 * Auto-detects which column holds which field. Header synonyms first, then the
 * shape of the values for the columns left over; each field is used once.
 * Columns left null end up in the notes, so nothing is ever dropped.
 */
export function detectMapping(parsed: ParsedCsv): ColumnMapping {
  const { headers, rows } = parsed;
  const column = (i: number) => rows.map(r => r[i] ?? "");
  const candidates: { col: number; field: LeadField; score: number }[] = [];
  headers.forEach((header, col) => {
    let byHeader = parsed.hasHeader ? headerMatch(header) : null;
    const bySniff = sniffColumn(column(col));
    // A loose header hit ("Email du gérant") loses to what the values plainly are.
    if (byHeader?.score === 2 && bySniff && bySniff !== byHeader.field) byHeader = { field: bySniff, score: 2.5 };
    if (byHeader) {
      // "Note" is a rating in Google exports and free text elsewhere.
      const field = byHeader.field === "rating" && !looksNumericRating(column(col)) ? "notes" : byHeader.field;
      candidates.push({ col, field, score: byHeader.score });
    }
    if (bySniff) candidates.push({ col, field: bySniff, score: byHeader ? 0.5 : 1 });
  });

  const mapping: ColumnMapping = headers.map(() => null);
  const used = new Set<LeadField>();
  for (const c of candidates.sort((a, b) => b.score - a.score || a.col - b.col)) {
    if (mapping[c.col] || used.has(c.field)) continue;
    mapping[c.col] = c.field;
    used.add(c.field);
  }
  // No usable name column: the first free text column becomes the name.
  if (!used.has("name")) {
    const col = headers.findIndex((_, i) => !mapping[i] && column(i).some(v => sniffValue(v) === "name"));
    if (col >= 0) mapping[col] = "name";
  }
  return mapping;
}

// ── Row → lead ───────────────────────────────────────────────────

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/[^\d,.-]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const METIER_KEYWORDS: [Metier, RegExp][] = [
  ["ONGLES", /ongle|nail|manucure|pedicure|onglerie/],
  ["BARBIER", /barb/],
  ["COIFFURE", /coiff|hair|cheveu|tresse|braid|afro|lissage/],
  ["SPA", /spa|massage|hammam|bien etre|wellness/],
  ["ESTHETIQUE", /esthet|beaute|beauty|institut|cils|lash|sourcil|brow|epil|soin|maquill/],
];

export function metiersFrom(raw: string): Metier[] {
  const v = normalizeHeader(raw);
  if (!v) return [];
  const found = METIER_KEYWORDS.filter(([, re]) => re.test(v)).map(([m]) => m);
  return found.length ? found : ["AUTRE"];
}

function clip(value: string | null | undefined, max = 300): string | null {
  const v = value?.replace(/\s+/g, " ").trim().replace(/^'(?=[+@\d])/, "");
  return v ? v.slice(0, max) : null;
}

function normalizeUrl(raw: string): string | null {
  const v = clip(raw, 500);
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

/** Builds one lead from a row. Never throws, never returns an empty name. */
export function rowToLead(row: string[], headers: string[], mapping: ColumnMapping, rowNumber: number): ImportedLead {
  const values: Partial<Record<LeadField, string>> = {};
  const extras: string[] = [];
  row.forEach((cell, i) => {
    const value = cell?.trim();
    if (!value) return;
    const field = mapping[i];
    if (field && !values[field]) values[field] = value;
    else extras.push(`${headers[i] ?? `Colonne ${i + 1}`} : ${value}`);
  });

  const address = clip(values.address);
  const postalCode = (values.postalCode?.match(/\b\d{5}\b/) ?? address?.match(/\b\d{5}\b/))?.[0]
    ?? (values.postalCode && /^\d{4}$/.test(values.postalCode.trim()) ? `0${values.postalCode.trim()}` : null);
  const city = clip(values.city, 120) ?? address?.match(/\b\d{5}\s+([^,\d]+)$/)?.[1]?.trim() ?? null;

  const email = values.email?.trim().toLowerCase().replace(/^mailto:/, "") ?? null;
  const validEmail = email && EMAIL_RE.test(email) ? email.slice(0, 200) : null;
  if (email && !validEmail) extras.push(`E-mail : ${values.email}`);

  const instagram = normalizeInstagramHandle(values.instagram);
  if (values.instagram && !instagram) extras.push(`Instagram : ${values.instagram}`);

  const booking = values.bookingUrl ? normalizeUrl(values.bookingUrl) : null;
  let website = values.website ? normalizeUrl(values.website) : null;
  if (values.website && !website) extras.push(`Site : ${values.website}`);
  const planityUrl = [booking, website].find(u => u && /planity\.com/i.test(u)) ?? null;
  const treatwellUrl = [booking, website].find(u => u && /treatwell\./i.test(u)) ?? null;
  if (booking && !planityUrl && !treatwellUrl) { if (website) extras.push(`Réservation : ${booking}`); else website = booking; }
  if (website && (website === planityUrl || website === treatwellUrl)) website = null;
  if (values.bookingUrl && !booking) extras.push(`Réservation : ${values.bookingUrl}`);

  const rating = values.rating ? parseNumber(values.rating) : null;
  const reviewCount = values.reviewCount ? parseNumber(values.reviewCount) : null;
  const notes = [clip(values.notes, 5000), ...extras].filter(Boolean).join("\n").slice(0, 10_000) || null;

  const contactName = clip(values.contactName, 200);
  const phone = clip(values.phone, 50);
  const name = clip(values.name, 200)
    ?? contactName
    ?? (instagram ? `@${instagram}` : null)
    ?? hostOf(website)
    ?? (validEmail ? validEmail.split("@")[0] : null)
    ?? phone
    ?? `Lead importé (ligne ${rowNumber})`;

  return {
    name, address, postalCode, city, phone, email: validEmail, instagram, website,
    planityUrl, treatwellUrl, contactName,
    metiers: values.metier ? metiersFrom(values.metier) : [],
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount: reviewCount !== null && reviewCount >= 0 ? Math.min(Math.round(reviewCount), 10_000_000) : 0,
    notes,
  };
}

/** Maps every row (up to MAX_IMPORT_ROWS). Row numbers match the spreadsheet. */
export function buildLeads(parsed: ParsedCsv, mapping: ColumnMapping): ImportedLead[] {
  const offset = parsed.hasHeader ? 2 : 1;
  return parsed.rows.slice(0, MAX_IMPORT_ROWS).map((row, i) => rowToLead(row, parsed.headers, mapping, i + offset));
}
