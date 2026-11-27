import { describe, expect, it } from "vitest";
import { computeThreeMonthAudienceGrowth, isDecemberPause, scoreAccountGtm1Bis } from "./scoring";

describe("GTM 1 bis 100-pt scoring", () => {
  it("applies the 3 pre-filters before scoring", () => {
    expect(scoreAccountGtm1Bis({ alreadyClient: true }).priority).toBe("EXCLU");
    expect(scoreAccountGtm1Bis({ isChainOrFranchise: true }).priority).toBe("CHAINE");
    expect(scoreAccountGtm1Bis({ igStatus: "INTROUVABLE", instagramHandle: null }).priority).toBe("HORS_CIBLE");
  });

  it("does NOT mark unverified IG prospects as HORS_CIBLE", () => {
    const res = scoreAccountGtm1Bis({
      igStatus: "A_FAIRE",
      instagramHandle: null,
      hasPlanity: true,
      hasTreatwell: true,
      postalCode: "75011",
    });
    expect(res.priority).not.toBe("HORS_CIBLE");
    expect(res.igUnverified).toBe(true);
    expect(res.score).toBe(25);
  });

  it("scores a full 100/100 Priority A dual-platform IDF salon and recommends Synchronization angle", () => {
    const res = scoreAccountGtm1Bis({
      instagramHandle: "maison_beaute",
      igStatus: "CONFIRME",
      hasPlanity: true,
      hasTreatwell: true,
      videosPerWeek: 2,
      instagramFollowers: 8500,
      bookingFriction: true,
      staffCount: 4,
      hasTimingSignal: true,
      googleRating: 4.8,
      googleReviewCount: 240,
      sellsProducts: true,
      postalCode: "75011",
    });
    expect(res.score).toBe(100);
    expect(res.priority).toBe("A");
    expect(res.angle).toBe("Synchronisation d'agenda");
    expect(res.breakdown).toHaveLength(9);
  });

  it("assigns Priority B (45-69) and Priority C (<45) correctly, and forces inbound leads to A", () => {
    const mid = scoreAccountGtm1Bis({
      instagramHandle: "studio_nails",
      hasPlanity: true,
      videosPerWeek: 1,
      instagramFollowers: 5000,
      staffCount: 3,
      postalCode: "92100",
    });
    expect(mid.score).toBe(55);
    expect(mid.priority).toBe("B");
    expect(mid.angle).toBe("Réservation depuis les vidéos");

    const low = scoreAccountGtm1Bis({
      instagramHandle: "petit_salon",
      hasPlanity: true,
      staffCount: 1,
      postalCode: "69001",
    });
    expect(low.score).toBe(15);
    expect(low.priority).toBe("C");
    expect(low.angle).toBe("Fidélisation et marketing");

    const inbound = scoreAccountGtm1Bis({
      instagramHandle: "petit_salon",
      hasPlanity: true,
      isInboundLead: true,
    });
    expect(inbound.priority).toBe("A");
  });

  it("computes 3-month audience growth and ignores sudden giveaways/bought spikes", () => {
    expect(
      computeThreeMonthAudienceGrowth([
        { monthKey: "2026-09", igFollowers: 2000 },
        { monthKey: "2026-10", igFollowers: 2200 },
        { monthKey: "2026-11", igFollowers: 2500 },
      ]),
    ).toEqual({ growthPct: 25, strongGrowth: true, spikeIgnored: false });

    expect(
      computeThreeMonthAudienceGrowth([
        { monthKey: "2026-09", igFollowers: 1000 },
        { monthKey: "2026-10", igFollowers: 4000 },
        { monthKey: "2026-11", igFollowers: 4100 },
      ]),
    ).toEqual({ growthPct: null, strongGrowth: false, spikeIgnored: true });
  });

  it("detects the Dec 20–31 pause in Europe/Paris", () => {
    expect(isDecemberPause(new Date("2026-12-19T12:00:00Z"))).toBe(false);
    expect(isDecemberPause(new Date("2026-12-20T12:00:00Z"))).toBe(true);
    expect(isDecemberPause(new Date("2026-12-31T12:00:00Z"))).toBe(true);
    expect(isDecemberPause(new Date("2027-01-01T12:00:00Z"))).toBe(false);
  });
});
