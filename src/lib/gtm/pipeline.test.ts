import { describe, expect, it } from "vitest";
import { computeCompositeRankScore, computeRevenueBonus, findSharedInstagramHandles } from "./pipeline";

describe("GTM ranking pipeline helpers", () => {
  it("computes revenue bonus & capped composite rank without altering GTM 1 bis", () => {
    expect(computeRevenueBonus({ revenueEur: 350_000 })).toBe(15);
    expect(computeRevenueBonus({ revenueEur: 180_000 })).toBe(10);
    expect(computeRevenueBonus({ revenueEur: 80_000 })).toBe(5);
    expect(computeRevenueBonus({ revenueEur: null, revenueStatus: "CONFIDENTIAL" })).toBe(2);
    expect(computeCompositeRankScore({ gtmScore: 42, revenueEur: 371_000 })).toBe(57);
    expect(computeCompositeRankScore({ gtmScore: 95, revenueEur: 500_000 })).toBe(100);
    expect(computeCompositeRankScore({ gtmScore: null, revenueEur: 500_000 })).toBeNull();
  });

  it("flags Instagram handles shared by 2+ distinct salons", () => {
    const shared = findSharedInstagramHandles([
      { dedupKey: "beauty nails|75011", handle: "@bigbrand" },
      { dedupKey: "atelier mathilde|75015", handle: "bigbrand" },
      { dedupKey: "salon unique|92100", handle: "@salonunique" },
    ]);
    expect(shared.has("bigbrand")).toBe(true);
    expect(shared.has("salonunique")).toBe(false);
  });
});
