import { describe, expect, it } from "vitest";
import {
  computeDealAgeDays,
  computePaceProjection,
  computeStageConversions,
  reconcileDealMrr,
  resolvePilotageRange,
} from "./metrics";

describe("Pilotage metrics & signed-vs-collected reconciliation", () => {
  it("resolves preset and custom date ranges with elapsed/total days", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const month = resolvePilotageRange({ range: "month" }, now);
    expect(month.start.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(month.totalDays).toBe(30);
    expect(month.elapsedDays).toBe(15);

    const custom = resolvePilotageRange({ from: "2026-10-01", to: "2026-10-10" }, now);
    expect(custom.key).toBe("custom");
    expect(custom.totalDays).toBe(10);
    expect(custom.elapsedDays).toBe(10);
  });

  it("projects end-of-period attainment at current pace", () => {
    // 810 EUR after 15 of 30 days -> projected 1620 EUR
    expect(computePaceProjection(810, 15, 30)).toBe(1620);
    expect(computePaceProjection(1000, 0, 30)).toBe(1000);
  });

  it("computes deal age in whole days", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    expect(computeDealAgeDays(new Date("2026-11-20T12:00:00Z"), now)).toBe(7);
    expect(computeDealAgeDays(new Date("2026-11-28T12:00:00Z"), now)).toBe(0);
  });

  it("computes stage-to-stage conversion rates cleanly", () => {
    const funnel = computeStageConversions({
      A_CONTACTER: 100,
      CONTACTE: 50,
      R1_PROGRAMME: 25,
      R1_EFFECTUE: 20,
      DEVIS_ENVOYE: 10,
      SIGNE: 5,
      ENCAISSE: 4,
    });
    expect(funnel.find((s) => s.stage === "CONTACTE")?.rateFromPrev).toBe(50);
    expect(funnel.find((s) => s.stage === "R1_EFFECTUE")?.rateFromPrev).toBe(80);
    expect(funnel.find((s) => s.stage === "ENCAISSE")?.rateFromPrev).toBe(80);
  });

  it("flags deal-by-deal MRR signed vs collected discrepancies", () => {
    const rows = reconcileDealMrr([
      { id: "o1", salonId: "s1", salonName: "Salon A", ownerName: "Simone", mrrSignedEur: 100, collectedEur: 100, hasRefundOrDispute: false },
      { id: "o2", salonId: "s2", salonName: "Salon B", ownerName: "Tiago", mrrSignedEur: 138, collectedEur: 0, hasRefundOrDispute: false },
      { id: "o3", salonId: "s3", salonName: "Salon C", ownerName: "Simone", mrrSignedEur: 79, collectedEur: 50, hasRefundOrDispute: false },
      { id: "o4", salonId: "s4", salonName: "Salon D", ownerName: "Tiago", mrrSignedEur: 79, collectedEur: 79, hasRefundOrDispute: true },
    ]);
    expect(rows[0].status).toBe("OK");
    expect(rows[1].status).toBe("UNPAID");
    expect(rows[1].deltaEur).toBe(-138);
    expect(rows[2].status).toBe("UNDERPAID");
    expect(rows[2].deltaEur).toBe(-29);
    expect(rows[3].status).toBe("REFUNDED_OR_DISPUTED");
  });
});
