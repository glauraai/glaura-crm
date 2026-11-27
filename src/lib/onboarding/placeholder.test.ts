import { describe, expect, it } from "vitest";
import { emptyCatalogReason, isPlaceholderProfile, REPAIRED_ACCOUNT_WARNING, usableSalonName, wasRepaired } from "./placeholder";

describe("emptyCatalogReason", () => {
  it("stops a CRM onboarding that read no services (dead or generic booking page)", () => {
    expect(emptyCatalogReason({ services: [] }, "https://fresha.com/a/x")).toBe(
      "Aucune prestation trouvée sur https://fresha.com/a/x : lien de réservation introuvable ou vide. Vérifie l’URL du salon puis relance.",
    );
  });
  it("lets an onboarding with services through", () => {
    expect(emptyCatalogReason({ services: [{}] }, "https://x")).toBeNull();
  });
});

describe("usableSalonName", () => {
  it("ignores the extractor's unknown placeholders and falls back to the CRM name", () => {
    expect(usableSalonName("(unknown)", "LATELIER DE SABRINA")).toBe("LATELIER DE SABRINA");
    expect(usableSalonName(" Unknown ", null)).toBeNull();
    expect(usableSalonName("Atelier de Sabrina", "LATELIER DE SABRINA")).toBe("Atelier de Sabrina");
  });
});

describe("isPlaceholderProfile", () => {
  it("flags an account created from an empty page", () => {
    expect(isPlaceholderProfile({ companyName: "(unknown)", companyUserName: "unknown" }, 63)).toBe(true);
    expect(isPlaceholderProfile({ companyName: "Salon Lila", companyUserName: "salon-lila" }, 0)).toBe(true);
  });
  it("leaves a real, filled account alone", () => {
    expect(isPlaceholderProfile({ companyName: "Salon Lila", companyUserName: "salon-lila" }, 12)).toBe(false);
  });
});

describe("wasRepaired", () => {
  it("spots the repair warning on a finished job", () => {
    expect(wasRepaired([REPAIRED_ACCOUNT_WARNING])).toBe(true);
    expect(wasRepaired(null)).toBe(false);
    expect(wasRepaired(["autre"])).toBe(false);
  });
});
