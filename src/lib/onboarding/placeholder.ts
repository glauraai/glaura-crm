// Pure rules for CRM onboardings that read nothing from the booking page.
// A dead or generic page (404, wrong link) extracts no services and a name of
// "(unknown)"; creating an account from that leaves an empty placeholder that a
// retry with the right link could never fill (the idempotency check stopped it).

/** Job warning recorded when a retry filled an empty account; the salon page shows it. */
export const REPAIRED_ACCOUNT_WARNING = "Compte existant incomplet : complété avec la page de réservation.";

const UNKNOWN_NAMES = new Set(["", "unknown", "(unknown)", "inconnu"]);

/** Why a CRM onboarding must stop before creating the account, or null. */
export function emptyCatalogReason(extract: { services: readonly unknown[] }, url: string): string | null {
  if (extract.services.length > 0) return null;
  return `Aucune prestation trouvée sur ${url} : lien de réservation introuvable ou vide. Vérifie l’URL du salon puis relance.`;
}

/** The extracted salon name, unless it is the extractor's "unknown" placeholder; else the CRM name. */
export function usableSalonName(extracted: string | null | undefined, crmName: string | null | undefined): string | null {
  for (const candidate of [extracted, crmName]) {
    const name = candidate?.trim() ?? "";
    if (!UNKNOWN_NAMES.has(name.toLowerCase())) return name;
  }
  return null;
}

/** An existing headless account that was created from an empty page and may be repaired in place. */
export function isPlaceholderProfile(
  profile: { companyName?: unknown; companyUserName?: unknown },
  activeServiceCount: number,
): boolean {
  if (activeServiceCount === 0) return true;
  const name = typeof profile.companyName === "string" ? profile.companyName.trim().toLowerCase() : "";
  const slug = typeof profile.companyUserName === "string" ? profile.companyUserName.trim().toLowerCase() : "";
  return UNKNOWN_NAMES.has(name) || UNKNOWN_NAMES.has(slug);
}

export function wasRepaired(warnings: unknown): boolean {
  return Array.isArray(warnings) && warnings.includes(REPAIRED_ACCOUNT_WARNING);
}
