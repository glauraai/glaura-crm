import { describe, expect, it } from "vitest";
import {
  buildDeterministicMentorEvaluation,
  computeClientSegmentation,
  computeClosingLevers,
  computeObjectionStats,
  computeOverallMentorScore,
  MENTOR_RUBRIC_STEPS,
} from "./mentor";

describe("MENTOR 8-step rubric & Pilotage analytics", () => {
  it("defines all 8 steps summing to 100 points", () => {
    expect(MENTOR_RUBRIC_STEPS).toHaveLength(8);
    expect(MENTOR_RUBRIC_STEPS.reduce((s, x) => s + x.maxScore, 0)).toBe(100);
  });

  it("scores transcripts deterministically and detects objections", () => {
    const evalRes = buildDeterministicMentorEvaluation(
      "Bonjour ! Voici votre compte préparé pour la démo. Quel est votre principal souci avec Planity ? Le tarif annuel inclut le site offert. On se fait un rappel mardi pour le devis ?",
    );
    const score = computeOverallMentorScore(evalRes.stepScores);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(evalRes.objections.some((o) => o.category === "DEJA_PLANITY_ACOMPTE_SMS")).toBe(true);
  });

  it("aggregates objection win rates, closing levers, and segment conversion", () => {
    const objStats = computeObjectionStats([
      { category: "COMMISSION", responseGiven: "0% sur vos clientes", succeeded: true },
      { category: "COMMISSION", responseGiven: "0% sur vos clientes", succeeded: false },
    ]);
    expect(objStats[0].successRatePct).toBe(50);

    const levers = computeClosingLevers([
      { outcome: "WON", closingLevers: ["Compte démo préparé", "Site offert annuel"] },
      { outcome: "WON", closingLevers: ["Compte démo préparé"] },
      { outcome: "LOST", closingLevers: ["Prix seul"] },
    ]);
    expect(levers[0].lever).toBe("Compte démo préparé");
    expect(levers[0].liftPct).toBe(100);

    const segs = computeClientSegmentation([
      { segment: "Priorité A", won: true, angle: "Synchronisation d'agenda" },
      { segment: "Priorité A", won: false, angle: "Synchronisation d'agenda" },
      { segment: "Priorité B", won: false, angle: "Fidélisation et marketing" },
    ]);
    expect(segs[0]).toEqual({
      segment: "Priorité A",
      total: 2,
      won: 1,
      conversionPct: 50,
      topAngle: "Synchronisation d'agenda",
    });
  });
});
