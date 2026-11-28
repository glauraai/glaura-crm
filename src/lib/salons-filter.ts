import type { Prisma } from "@/generated/prisma/client";

export type SalonOriginKey =
  | "website"
  | "website_pro"
  | "website_laura"
  | "website_callback"
  | "scrape"
  | "import"
  | "airtable";

export const ORIGIN_LABELS: Record<SalonOriginKey, string> = {
  website: "Site web (/pro, /laura, rappel)",
  website_pro: "Site web · /pro",
  website_laura: "Site web · /laura",
  website_callback: "Site web · Demande de rappel",
  scrape: "Prospection",
  import: "Import CSV",
  airtable: "Airtable",
};

export const WEBSITE_ORIGIN_KEYS: readonly SalonOriginKey[] = [
  "website",
  "website_pro",
  "website_laura",
  "website_callback",
];

export function isWebsiteOrigin(origin: string | undefined): boolean {
  return Boolean(origin && (WEBSITE_ORIGIN_KEYS as readonly string[]).includes(origin));
}

/**
 * Builds a Prisma SalonWhereInput for the Provenance / Origin filter.
 * Captures every website inbound path:
 * - /pro self-serve signups & previews (`self_serve:*`, `self_serve_email:*`, `Page /pro/creer-ma-page`, `Page /compte-en-24h`)
 * - /laura & Laura essai demos (`laura_essai`, `Page /laura`, `laura_lead:*`, `laura_lead_phone:*`)
 * - "Être rappelé" callback forms (`Rappel *`, `Page /laura`, `laura_lead*`, `priorityLabel` "Lead entrant")
 */
export function buildOriginWhere(origin: string | undefined): Prisma.SalonWhereInput | null {
  switch (origin) {
    case "website":
      return {
        OR: [
          { externalRef: { startsWith: "self_serve:" } },
          { externalRef: { startsWith: "self_serve_email:" } },
          { externalRef: { startsWith: "laura_lead:" } },
          { externalRef: { startsWith: "laura_lead_phone:" } },
          { sourceLabel: { startsWith: "Page /" } },
          { sourceLabel: { startsWith: "Rappel " } },
          { sourceLabel: "laura_essai" },
          { priorityLabel: { contains: "Lead entrant", mode: "insensitive" } },
        ],
      };
    case "website_pro":
      return {
        AND: [
          {
            OR: [
              { externalRef: { startsWith: "self_serve:" } },
              { externalRef: { startsWith: "self_serve_email:" } },
              { sourceLabel: "Page /pro/creer-ma-page" },
              { sourceLabel: "Page /compte-en-24h" },
              { sourceLabel: { startsWith: "Rappel /pro" } },
            ],
          },
          { NOT: { sourceLabel: "laura_essai" } },
        ],
      };
    case "website_laura":
      return {
        OR: [
          { sourceLabel: "laura_essai" },
          { sourceLabel: "Page /laura" },
          { externalRef: { startsWith: "laura_lead:" } },
          { externalRef: { startsWith: "laura_lead_phone:" } },
        ],
      };
    case "website_callback":
      return {
        OR: [
          { sourceLabel: { startsWith: "Rappel " } },
          { sourceLabel: "Page /laura" },
          { externalRef: { startsWith: "laura_lead:" } },
          { externalRef: { startsWith: "laura_lead_phone:" } },
          { priorityLabel: { contains: "Lead entrant", mode: "insensitive" } },
        ],
      };
    case "scrape":
      return { source: "SCRAPE" };
    case "import":
      return {
        OR: [
          { sourceLabel: "Import CSV" },
          {
            AND: [
              { source: "IMPORT" },
              { NOT: { externalRef: { startsWith: "self_serve" } } },
              { NOT: { sourceLabel: "laura_essai" } },
            ],
          },
        ],
      };
    case "airtable":
      return { source: "AIRTABLE" };
    default:
      return null;
  }
}

export const GTM_FILTER_LABELS: Record<string, string> = {
  A: "A · Prioritaire (≥ 70)",
  B: "B · Potentiel (45–69)",
  C: "C · Nurture (< 45)",
  CHAINE: "Chaînes / Franchises",
};
