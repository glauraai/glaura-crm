import { describe, expect, it } from "vitest";
import { calculateOfferPricing, GLAURA_PLANS } from "./catalog";

describe("Glaura subscription pricing & payment calculator", () => {
  it("computes monthly HT, 20% VAT, TTC and signed MRR accurately", () => {
    const res = calculateOfferPricing({
      planCode: "salon_v3",
      cadence: "MONTHLY",
      lauraChannels: "both",
      syncIncluded: true,
      discountPercent: 0,
    });
    // 79 + 99 + 19 = 197 EUR HT/month
    expect(res.listMonthlyCents).toBe(19700);
    expect(res.netMonthlyCents).toBe(19700);
    expect(res.mrrSignedEur).toBe(197);
    expect(res.todayHtCents).toBe(19700);
    expect(res.todayTtcCents).toBe(23640);
    expect(res.freeWebsiteIncluded).toBe(false);
  });

  it("computes Annual 1x (10 months = 2 free months) and includes free 500 EUR website on Solo/Équipe", () => {
    const res = calculateOfferPricing({
      planCode: "salon_solo",
      cadence: "ANNUAL_1X",
      lauraChannels: null,
      syncIncluded: false,
      discountPercent: 0,
    });
    // 39 EUR/mo catalog MRR; annual 1x = 39 * 10 = 390 EUR HT upfront
    expect(res.mrrSignedEur).toBe(39);
    expect(res.freeMonths).toBe(2);
    expect(res.todayHtCents).toBe(39000);
    expect(res.todayTtcCents).toBe(46800);
    expect(res.freeWebsiteIncluded).toBe(true);
  });

  it("maps Solo 39 EUR to solo_pro_v3, not legacy premium_v3", () => {
    const solo = GLAURA_PLANS.find((p) => p.code === "salon_solo");
    expect(solo?.monthlyHtCents).toBe(3900);
    expect(solo?.stripeV3Code).toBe("solo_pro_v3");
  });

  it("computes Annual 3x (11 months split in 3 installments, 1 month free)", () => {
    const res = calculateOfferPricing({
      planCode: "salon_v3",
      cadence: "ANNUAL_3X",
      lauraChannels: "instagram",
      syncIncluded: false,
      discountPercent: 0,
    });
    // (79 + 59) = 138 EUR/mo -> 138 * 11 = 1518 EUR HT -> 3 x 506 EUR HT
    expect(res.mrrSignedEur).toBe(138);
    expect(res.freeMonths).toBe(1);
    expect(res.annualTotalHtCents).toBe(151800);
    expect(res.todayHtCents).toBe(50600);
    expect(res.freeWebsiteIncluded).toBe(true);
  });

  it("flags >10% monthly discount impact on commission while keeping all catalog plans defined", () => {
    expect(GLAURA_PLANS.map((p) => p.code)).toContain("essentiel_v3");
    expect(GLAURA_PLANS.map((p) => p.code)).toContain("salon_solo");
    expect(GLAURA_PLANS.map((p) => p.code)).toContain("salon_v3");

    const discounted = calculateOfferPricing({
      planCode: "salon_v3",
      cadence: "MONTHLY",
      lauraChannels: null,
      syncIncluded: false,
      discountPercent: 20,
    });
    expect(discounted.netMonthlyCents).toBe(6320);
    expect(discounted.commissionDiscountFactor).toBe(0.8);
  });
});
