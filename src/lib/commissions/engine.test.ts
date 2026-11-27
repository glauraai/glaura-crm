import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_RULES,
  calculateDealCommissionBase,
  calculateMonthlyPayroll,
  evaluateCommissionLifecycle,
  exportPayrollCsv,
  isDisputeWindowOpen,
} from "./engine";

describe("Glaura sales commission engine (Fodé plan)", () => {
  it("computes base commission with exact 0.7716 rate and >10% monthly discount penalty only", () => {
    // No discount: 100 EUR MRR * 0.7716 = 77.16 EUR
    expect(calculateDealCommissionBase({ mrrSignedEur: 100, cadence: "MONTHLY", discountPercent: 0 }, DEFAULT_PLAN_RULES)).toBeCloseTo(77.16, 2);
    // 10% monthly discount: no reduction
    expect(calculateDealCommissionBase({ mrrSignedEur: 100, cadence: "MONTHLY", discountPercent: 10 }, DEFAULT_PLAN_RULES)).toBeCloseTo(77.16, 2);
    // 20% monthly discount: reduced by 20%
    expect(calculateDealCommissionBase({ mrrSignedEur: 100, cadence: "MONTHLY", discountPercent: 20 }, DEFAULT_PLAN_RULES)).toBeCloseTo(61.73, 2);
    // Annual 1x with free months: stays on full catalog MRR (never reduced by free months)
    expect(calculateDealCommissionBase({ mrrSignedEur: 100, cadence: "ANNUAL_1X", discountPercent: 16.7 }, DEFAULT_PLAN_RULES)).toBeCloseTo(77.16, 2);
  });

  it("applies monthly non-cumulative slice accelerators (x1 up to 100%, x2 100-150%, x3 >150%)", () => {
    // Standard target 1620 EUR:
    // Slice 1: 0..1620 -> 1620 * 0.7716 * 1 = 1249.992
    // Slice 2: 1620..2430 (810 EUR) -> 810 * 0.7716 * 2 = 1249.992
    // Slice 3: 2430..2930 (500 EUR) -> 500 * 0.7716 * 3 = 1157.40
    // Total = 3657.38
    const result = calculateMonthlyPayroll({
      targetMrrEur: 1620,
      isRampMonth: false,
      dmCallsCount: 0,
      meetingsCount: 0,
      deals: [
        { id: "d1", mrrSignedEur: 1620, cadence: "MONTHLY", discountPercent: 0, status: "ACQUISE" },
        { id: "d2", mrrSignedEur: 810, cadence: "MONTHLY", discountPercent: 0, status: "ACQUISE" },
        { id: "d3", mrrSignedEur: 500, cadence: "MONTHLY", discountPercent: 0, status: "ACQUISE" },
      ],
      rules: DEFAULT_PLAN_RULES,
    });

    expect(result.validMrrEur).toBe(2930);
    expect(result.attainmentRatio).toBeCloseTo(2930 / 1620, 4);
    expect(result.currentMultiplier).toBe(3);
    expect(result.earnedCommissionEur).toBeCloseTo(3657.38, 1);
    expect(result.guaranteeApplied).toBe(false);
    expect(result.payableEur).toBeCloseTo(3657.38, 1);
  });

  it("applies M1/M2 1250 EUR guarantee only when >= 120 DM calls and >= 40 meetings", () => {
    const met = calculateMonthlyPayroll({
      targetMrrEur: 810,
      isRampMonth: true,
      dmCallsCount: 120,
      meetingsCount: 40,
      deals: [{ id: "d1", mrrSignedEur: 400, cadence: "MONTHLY", discountPercent: 0, status: "ACQUISE" }],
      rules: DEFAULT_PLAN_RULES,
    });
    expect(met.guaranteeEligible).toBe(true);
    expect(met.guaranteeApplied).toBe(true);
    expect(met.payableEur).toBe(1250);

    const missed = calculateMonthlyPayroll({
      targetMrrEur: 810,
      isRampMonth: true,
      dmCallsCount: 119,
      meetingsCount: 40,
      deals: [{ id: "d1", mrrSignedEur: 400, cadence: "MONTHLY", discountPercent: 0, status: "ACQUISE" }],
      rules: DEFAULT_PLAN_RULES,
    });
    expect(missed.guaranteeEligible).toBe(false);
    expect(missed.payableEur).toBeCloseTo(400 * 0.7716, 2);
  });

  it("evaluates invoice-based lifecycle (2 consecutive paid invoices for monthly, 1 for annual, cancellation before 2)", () => {
    expect(evaluateCommissionLifecycle({ cadence: "MONTHLY", validPaidInvoices: 0, cancelled: false, refundedOrDisputed: false }, DEFAULT_PLAN_RULES)).toBe("PREVUE");
    expect(evaluateCommissionLifecycle({ cadence: "MONTHLY", validPaidInvoices: 1, cancelled: false, refundedOrDisputed: false }, DEFAULT_PLAN_RULES)).toBe("EN_VALIDATION");
    expect(evaluateCommissionLifecycle({ cadence: "MONTHLY", validPaidInvoices: 2, cancelled: false, refundedOrDisputed: false }, DEFAULT_PLAN_RULES)).toBe("ACQUISE");
    expect(evaluateCommissionLifecycle({ cadence: "MONTHLY", validPaidInvoices: 1, cancelled: true, refundedOrDisputed: false }, DEFAULT_PLAN_RULES)).toBe("PERDUE");
    // Once 2 paid invoices reached, later cancellation keeps commission acquired
    expect(evaluateCommissionLifecycle({ cadence: "MONTHLY", validPaidInvoices: 2, cancelled: true, refundedOrDisputed: false }, DEFAULT_PLAN_RULES)).toBe("ACQUISE");
    // Annual 1x / 3x acquired on 1st valid payment
    expect(evaluateCommissionLifecycle({ cadence: "ANNUAL_1X", validPaidInvoices: 1, cancelled: false, refundedOrDisputed: false }, DEFAULT_PLAN_RULES)).toBe("ACQUISE");
    expect(evaluateCommissionLifecycle({ cadence: "ANNUAL_3X", validPaidInvoices: 1, cancelled: false, refundedOrDisputed: false }, DEFAULT_PLAN_RULES)).toBe("ACQUISE");
  });

  it("enforces 15-day dispute window and exports formula-safe payroll CSV", () => {
    const settled = new Date("2027-01-02T10:00:00Z");
    expect(isDisputeWindowOpen(settled, new Date("2027-01-16T10:00:00Z"))).toBe(true);
    expect(isDisputeWindowOpen(settled, new Date("2027-01-18T10:00:00Z"))).toBe(false);

    const csv = exportPayrollCsv([
      {
        month: "2026-11",
        repName: "Simone Hermetet",
        repEmail: "simone@glaura.fr",
        salonName: "=EVIL() Salon",
        mrrSignedEur: 138,
        cadence: "ANNUAL_1X",
        status: "ACQUISE",
        commissionEur: 106.48,
      },
    ]);
    expect(csv).toContain("'=EVIL() Salon");
    expect(csv).toContain("simone@glaura.fr");
    expect(csv).toContain("106.48");
  });
});
