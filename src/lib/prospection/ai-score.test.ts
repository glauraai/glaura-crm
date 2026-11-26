import { describe, expect, it } from "vitest";
import {
  aiScoreBadgeStyle,
  annuaireEntreprisesUrl,
  formatRevenueEur,
  parseProspectEnrichmentRow,
} from "./ai-score";

describe("ai-score helpers", () => {
  it("formats revenue in compact French EUR notation with year", () => {
    expect(formatRevenueEur(87386, 2025)).toBe("87 k€ (2025)");
    expect(formatRevenueEur(148000, 2024)).toBe("148 k€ (2024)");
    expect(formatRevenueEur(1250000, 2025)).toBe("1,25 M€ (2025)");
    expect(formatRevenueEur(null, 2025)).toBeNull();
  });

  it("builds Annuaire des Entreprises links from SIRET or SIREN", () => {
    expect(annuaireEntreprisesUrl("92516818900015", "925168189")).toBe(
      "https://annuaire-entreprises.data.gouv.fr/etablissement/92516818900015",
    );
    expect(annuaireEntreprisesUrl(null, "925168189")).toBe(
      "https://annuaire-entreprises.data.gouv.fr/entreprise/925168189",
    );
    expect(annuaireEntreprisesUrl(null, null)).toBeNull();
  });

  it("picks badge styles by score threshold", () => {
    expect(aiScoreBadgeStyle(85)).toContain("emerald");
    expect(aiScoreBadgeStyle(65)).toContain("amber");
    expect(aiScoreBadgeStyle(40)).toContain("slate");
    expect(aiScoreBadgeStyle(null)).toContain("slate");
  });

  it("validates and normalizes enrichment rows safely", () => {
    const parsed = parseProspectEnrichmentRow({
      id: "cm_test_1",
      aiScore: 105.4,
      aiSpecialty: "both",
      aiOwnership: "independent_indicated",
      aiSummary: "Nail and lash studio",
      legalEntity: "GATSBY BEAUTY",
      siren: "925168189",
      siret: "92516818900015",
      activeSites: 1,
      companyMatchStatus: "VERIFIED",
      revenueEur: 87386,
      revenueYear: 2025,
      revenueStatus: "PUBLISHED",
      filingUrl: "https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:C202601557014",
    });

    expect(parsed).toMatchObject({
      id: "cm_test_1",
      aiScore: 100,
      aiSpecialty: "both",
      aiOwnership: "independent_indicated",
      siren: "925168189",
      siret: "92516818900015",
      revenueEur: 87386,
      revenueYear: 2025,
      revenueStatus: "PUBLISHED",
    });

    // Rejects mismatched SIRET/SIREN and unsafe URLs
    const sanitized = parseProspectEnrichmentRow({
      id: "cm_test_2",
      aiScore: 52.3,
      aiSpecialty: "invalid_val",
      siren: "123456789",
      siret: "99999999900011",
      filingUrl: "javascript:alert(1)",
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized!.aiSpecialty).toBe("unknown");
    expect(sanitized!.siret).toBeNull();
    expect(sanitized!.filingUrl).toBeNull();
    expect(parseProspectEnrichmentRow({ aiScore: 50 })).toBeNull();
  });
});
