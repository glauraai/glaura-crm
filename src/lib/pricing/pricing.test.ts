import { describe, expect, it } from "vitest";
import { buildStripeOfferLinkPayload, calculateOfferPricing, GLAURA_PLANS, LAURA_OPTIONS } from "./catalog";

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

  it("no longer offers the retired premium_v3 / tout_en_un_v3 plans", () => {
    const codes = GLAURA_PLANS.flatMap((p) => [p.code, p.stripeV3Code]);
    expect(codes).not.toContain("premium_v3");
    expect(codes).not.toContain("tout_en_un_v3");
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

  it("matches Stripe V3 catalog prices and builds valid admin-create-offer-link payloads", () => {
    const fullLaura = LAURA_OPTIONS.find((o) => o.code === "full");
    expect(fullLaura?.monthlyHtCents).toBe(19900);

    // Annual 1x & 3x MUST pass freeMonths: 0 (catalog already bakes in 2 / 1 free months)
    const annual1x = buildStripeOfferLinkPayload({
      providerId: "prov-1",
      planCode: "salon_solo",
      cadence: "ANNUAL_1X",
      lauraChannels: "both",
      syncIncluded: true,
    });
    expect(annual1x.ok).toBe(true);
    if (annual1x.ok) {
      expect(annual1x.body).toEqual({
        providerId: "prov-1",
        planCode: "solo_pro_v3",
        billingCadence: "annual_1x",
        laura: true,
        lauraChannels: "both",
        freeMonths: 0,
      });
      expect(annual1x.syncExcludedFromStripe).toBe(true);
    }

    // Monthly with syncIncluded must NOT exceed planCents + lauraCents
    const monthly = buildStripeOfferLinkPayload({
      providerId: "prov-1",
      planCode: "salon_v3",
      cadence: "MONTHLY",
      lauraChannels: "instagram",
      discountPercent: 0,
      syncIncluded: true,
    });
    expect(monthly.ok).toBe(true);
    if (monthly.ok) {
      expect(monthly.body).toEqual({
        providerId: "prov-1",
        planCode: "salon_v3",
        billingCadence: "monthly",
        laura: true,
        lauraChannels: "instagram",
        customMonthlyPriceCents: 13800, // 79 + 59 (excludes CRM-only 19 EUR sync)
        duration: "forever",
      });
    }

    // Monthly discount preserves full Laura price floor (adminOfferLink.js rule)
    const heavyDiscount = buildStripeOfferLinkPayload({
      providerId: "prov-1",
      planCode: "salon_solo",
      cadence: "MONTHLY",
      lauraChannels: "both",
      discountPercent: 80,
    });
    expect(heavyDiscount.ok).toBe(true);
    if (heavyDiscount.ok) {
      expect(heavyDiscount.body.customMonthlyPriceCents).toBe(9900);
    }
  });
});
