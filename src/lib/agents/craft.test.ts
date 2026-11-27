import { describe, expect, it } from "vitest";
import { recommendCraftOffer } from "./craft";

describe("CRAFT offer recommender", () => {
  it("recommends Salon équipe + Sync + Laura IG for multi-staff dual-platform salon", () => {
    const rec = recommendCraftOffer({
      salonSizeHint: "4 praticiens",
      hasPlanity: true,
      hasTreatwell: true,
      mainPain: "Réponse aux DM Instagram hors horaires",
    });
    expect(rec.planCode).toBe("salon_v3");
    expect(rec.cadence).toBe("ANNUAL_1X");
    expect(rec.syncIncluded).toBe(true);
    expect(rec.lauraChannels).toBe("instagram");
  });

  it("recommends Indépendante monthly for solo auto-entrepreneure", () => {
    const rec = recommendCraftOffer({
      salonSizeHint: "Indépendante à domicile",
      hasPlanity: false,
      hasTreatwell: false,
    });
    expect(rec.planCode).toBe("essentiel_v3");
    expect(rec.cadence).toBe("MONTHLY");
    expect(rec.syncIncluded).toBe(false);
  });
});
