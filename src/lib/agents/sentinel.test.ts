import { describe, expect, it } from "vitest";
import { evaluateDealRiskSignals } from "./sentinel";

describe("SENTINEL deal risk detection", () => {
  const now = new Date("2026-11-28T10:00:00Z");

  it("flags NO_SHOW > 24h without follow-up", () => {
    const signals = evaluateDealRiskSignals(
      {
        stage: "NO_SHOW",
        salonName: "Salon Lumière",
        updatedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000),
        lastActivityAt: null,
        nextStepAt: null,
        signedAt: null,
        salonActivatedAt: null,
        paidInvoicesCount: 0,
        hasPaymentIssue: false,
        contactCount: 1,
        hasDecisionMakerContact: true,
      },
      now,
    );
    expect(signals.map((s) => s.code)).toContain("NO_SHOW_24H");
  });

  it("flags DEVIS_ENVOYE > 5d and non-decision-maker only", () => {
    const signals = evaluateDealRiskSignals(
      {
        stage: "DEVIS_ENVOYE",
        salonName: "Studio Rose",
        updatedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
        lastActivityAt: null,
        nextStepAt: null,
        signedAt: null,
        salonActivatedAt: null,
        paidInvoicesCount: 0,
        hasPaymentIssue: false,
        contactCount: 1,
        hasDecisionMakerContact: false,
      },
      now,
    );
    expect(signals.map((s) => s.code)).toEqual(["QUOTE_NO_REPLY_5D", "NON_DECISION_MAKER_ONLY"]);
  });

  it("flags SIGNE > 7d not activated and unpaid > 10d", () => {
    const signals = evaluateDealRiskSignals(
      {
        stage: "SIGNE",
        salonName: "Maison Belle",
        updatedAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
        lastActivityAt: null,
        nextStepAt: null,
        signedAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
        salonActivatedAt: null,
        paidInvoicesCount: 0,
        hasPaymentIssue: false,
        contactCount: 1,
        hasDecisionMakerContact: true,
      },
      now,
    );
    expect(signals.map((s) => s.code)).toEqual(["NOT_ACTIVATED_7D", "SIGNED_UNPAID"]);
  });

  it("returns no risk for closed deals (ENCAISSE / PERDU)", () => {
    const signals = evaluateDealRiskSignals(
      {
        stage: "ENCAISSE",
        salonName: "Closed Salon",
        updatedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        lastActivityAt: null,
        nextStepAt: null,
        signedAt: null,
        salonActivatedAt: null,
        paidInvoicesCount: 2,
        hasPaymentIssue: false,
        contactCount: 0,
        hasDecisionMakerContact: false,
      },
      now,
    );
    expect(signals).toEqual([]);
  });
});
