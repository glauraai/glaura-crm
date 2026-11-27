import { describe, expect, it } from "vitest";
import {
  extractLatestFinance,
  isKnownChainName,
  pickBestAnnuaireMatch,
  staffFromInseeTranche,
} from "./company-enrichment";

describe("company-enrichment helpers", () => {
  it("extracts latest published CA and net result from finances map", () => {
    expect(
      extractLatestFinance({
        "2022": { ca: 210000, resultat_net: 12000 },
        "2024": { ca: 345000, resultat_net: 41000 },
        "2023": { ca: 280000, resultat_net: 22000 },
      }),
    ).toEqual({ revenueEur: 345000, netResultEur: 41000, revenueYear: 2024 });
  });

  it("detects known French beauty chains and maps INSEE staff tranches", () => {
    expect(isKnownChainName("MOD S HAIR")).toBe(true);
    expect(isKnownChainName("Franck Provost Paris 11")).toBe(true);
    expect(isKnownChainName("Maison Astella")).toBe(false);
    expect(staffFromInseeTranche("02", false)).toBe(4);
    expect(staffFromInseeTranche(null, true)).toBe(1);
  });

  it("picks verified match when name + postalCode + beauty NAF align", () => {
    const picked = pickBestAnnuaireMatch(
      { name: "Maison Astella", postalCode: "92100", address: "12 Rue Escudier 92100 Boulogne" },
      [
        {
          siren: "123456789",
          nom_complet: "MAISON ASTELLA",
          activite_principale: "96.02B",
          etat_administratif: "A",
          siege: { siret: "12345678900012", code_postal: "92100", adresse: "12 RUE ESCUDIER 92100 BOULOGNE" },
        },
      ],
    );
    expect(picked?.status).toBe("VERIFIED");
    expect(picked?.match.siren).toBe("123456789");
  });
});
