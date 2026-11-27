import { describe, expect, it } from "vitest";
import { analyzeInstagramSignals } from "./ig-signals";

describe("analyzeInstagramSignals", () => {
  it("computes videosPerWeek, booking friction, Planity/Treatwell, products & hiring signals", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    const res = analyzeInstagramSignals(
      {
        handle: "maison_beaute",
        followers: 6200,
        biography: "Réservation en DM ou sur Planity · E-shop cosmétiques · On recrute !",
        website: "https://linktr.ee/maisonbeaute",
        recentMedia: Array.from({ length: 10 }, (_, i) => ({
          media_type: "VIDEO",
          timestamp: new Date(now.getTime() - i * 5 * 24 * 60 * 60 * 1000).toISOString(),
        })),
      },
      now,
    );
    expect(res.videosPerWeek).toBeGreaterThanOrEqual(1);
    expect(res.bookingFriction).toBe(true);
    expect(res.detectedPlanity).toBe(true);
    expect(res.sellsProducts).toBe(true);
    expect(res.hiringSignal).toBe(true);
  });
});
