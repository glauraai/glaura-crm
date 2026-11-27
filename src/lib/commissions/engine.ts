import type { BillingCadence, CommissionStatus } from "@/generated/prisma/enums";

export type CommissionPlanRules = {
  baseRate: number; // 1250 / 1620 = 0.7716
  m1TargetEur: number;
  standardTargetEur: number;
  accel2Threshold: number; // 1.0 (100%)
  accel2Multiplier: number; // 2.0
  accel3Threshold: number; // 1.5 (150%)
  accel3Multiplier: number; // 3.0
  guaranteeEur: number; // 1250
  guaranteeMinDmCalls: number; // 120
  guaranteeMinMeetings: number; // 40
  minDecisionMakerCallSec: number; // 90
  excludeCancelledBeforeTwoInvoices: boolean; // true
};

export const DEFAULT_PLAN_RULES: CommissionPlanRules = {
  baseRate: 0.7716,
  m1TargetEur: 810,
  standardTargetEur: 1620,
  accel2Threshold: 1.0,
  accel2Multiplier: 2.0,
  accel3Threshold: 1.5,
  accel3Multiplier: 3.0,
  guaranteeEur: 1250,
  guaranteeMinDmCalls: 120,
  guaranteeMinMeetings: 40,
  minDecisionMakerCallSec: 90,
  excludeCancelledBeforeTwoInvoices: true,
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function discountFactorForDeal(cadence: BillingCadence, discountPercent: number): number {
  if (cadence !== "MONTHLY") return 1; // Annual 1x / 3x stay at full catalog MRR despite free months
  if (discountPercent <= 10) return 1;
  return Math.max(0, 1 - discountPercent / 100);
}

export function calculateDealCommissionBase(
  deal: { mrrSignedEur: number; cadence: BillingCadence; discountPercent: number },
  rules: CommissionPlanRules,
): number {
  const factor = discountFactorForDeal(deal.cadence, deal.discountPercent);
  return round2(Math.max(0, deal.mrrSignedEur) * rules.baseRate * factor);
}

export type PayrollDealInput = {
  id: string;
  mrrSignedEur: number;
  cadence: BillingCadence;
  discountPercent: number;
  status: CommissionStatus;
};

export type MonthlyPayrollResult = {
  validMrrEur: number;
  targetMrrEur: number;
  attainmentRatio: number;
  currentMultiplier: number;
  mrrToNextTierEur: number | null;
  earnedCommissionEur: number;
  guaranteeEligible: boolean;
  guaranteeApplied: boolean;
  payableEur: number;
  perDealFinalEur: Record<string, number>;
};

export function calculateMonthlyPayroll(input: {
  targetMrrEur: number;
  isRampMonth: boolean;
  dmCallsCount: number;
  meetingsCount: number;
  deals: PayrollDealInput[];
  rules: CommissionPlanRules;
}): MonthlyPayrollResult {
  const { targetMrrEur, isRampMonth, dmCallsCount, meetingsCount, deals, rules } = input;
  const activeDeals = deals.filter((d) => d.status !== "PERDUE");

  const tier2Start = targetMrrEur * rules.accel2Threshold;
  const tier3Start = targetMrrEur * rules.accel3Threshold;

  let cumulativeMrr = 0;
  let earnedTotal = 0;
  const perDealFinalEur: Record<string, number> = {};

  for (const deal of activeDeals) {
    const mrr = Math.max(0, deal.mrrSignedEur);
    const factor = discountFactorForDeal(deal.cadence, deal.discountPercent);
    const start = cumulativeMrr;
    const end = cumulativeMrr + mrr;

    // Slice allocations (strictly on the slice above threshold, non-cumulative across months)
    const slice1 = Math.max(0, Math.min(end, tier2Start) - start);
    const slice2 = Math.max(0, Math.min(end, tier3Start) - Math.max(start, tier2Start));
    const slice3 = Math.max(0, end - Math.max(start, tier3Start));

    const dealAmount =
      (slice1 * 1 + slice2 * rules.accel2Multiplier + slice3 * rules.accel3Multiplier) *
      rules.baseRate *
      factor;

    perDealFinalEur[deal.id] = round2(dealAmount);
    earnedTotal += dealAmount;
    cumulativeMrr = end;
  }

  for (const lost of deals.filter((d) => d.status === "PERDUE")) {
    perDealFinalEur[lost.id] = 0;
  }

  const attainmentRatio = targetMrrEur > 0 ? cumulativeMrr / targetMrrEur : 0;
  const currentMultiplier =
    cumulativeMrr >= tier3Start
      ? rules.accel3Multiplier
      : cumulativeMrr >= tier2Start
        ? rules.accel2Multiplier
        : 1;

  const mrrToNextTierEur =
    cumulativeMrr < tier2Start
      ? round2(tier2Start - cumulativeMrr)
      : cumulativeMrr < tier3Start
        ? round2(tier3Start - cumulativeMrr)
        : null;

  const earnedCommissionEur = round2(earnedTotal);
  const guaranteeEligible =
    isRampMonth &&
    dmCallsCount >= rules.guaranteeMinDmCalls &&
    meetingsCount >= rules.guaranteeMinMeetings;
  const guaranteeApplied = guaranteeEligible && rules.guaranteeEur > earnedCommissionEur;
  const payableEur = guaranteeApplied ? rules.guaranteeEur : earnedCommissionEur;

  return {
    validMrrEur: round2(cumulativeMrr),
    targetMrrEur,
    attainmentRatio,
    currentMultiplier,
    mrrToNextTierEur,
    earnedCommissionEur,
    guaranteeEligible,
    guaranteeApplied,
    payableEur,
    perDealFinalEur,
  };
}

export function evaluateCommissionLifecycle(
  input: {
    cadence: BillingCadence;
    validPaidInvoices: number;
    cancelled: boolean;
    refundedOrDisputed: boolean;
  },
  rules: CommissionPlanRules,
): CommissionStatus {
  const requiredInvoices = input.cadence === "MONTHLY" ? 2 : 1;

  if (input.validPaidInvoices >= requiredInvoices && !input.refundedOrDisputed) {
    return "ACQUISE";
  }
  if ((input.cancelled || input.refundedOrDisputed) && rules.excludeCancelledBeforeTwoInvoices) {
    return "PERDUE";
  }
  if (input.validPaidInvoices >= 1) {
    return "EN_VALIDATION";
  }
  return "PREVUE";
}

export function isDisputeWindowOpen(settledAt: Date | null | undefined, now = new Date()): boolean {
  if (!settledAt) return true;
  const diffDays = (now.getTime() - settledAt.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 15;
}

export type PayrollCsvRow = {
  month: string;
  repName: string;
  repEmail: string;
  salonName: string;
  mrrSignedEur: number;
  cadence: string;
  status: string;
  commissionEur: number;
};

function csvSafeCell(value: string | number): string {
  const str = String(value);
  const safe = /^[=+\-@]/.test(str.trimStart()) ? `'${str}` : str;
  if (/[",\n\r;]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function exportPayrollCsv(rows: PayrollCsvRow[]): string {
  const headers = ["mois", "commercial", "email", "salon", "mrr_signe_eur", "facturation", "statut", "commission_eur"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.month,
        r.repName,
        r.repEmail,
        r.salonName,
        r.mrrSignedEur.toFixed(2),
        r.cadence,
        r.status,
        r.commissionEur.toFixed(2),
      ]
        .map(csvSafeCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

export function quarterKeyForDate(date = new Date()): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

export function monthKeyForDate(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
