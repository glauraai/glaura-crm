import { STAGE_META_MAP } from "@/lib/pipeline/stages";
import type { OpportunityStage } from "@/generated/prisma/enums";

export type PilotageRangeKey = "week" | "month" | "quarter" | "year" | "custom";

export type ResolvedPilotageRange = {
  key: PilotageRangeKey;
  label: string;
  start: Date;
  end: Date;
  fromInput: string;
  toInput: string;
  totalDays: number;
  elapsedDays: number;
  monthKeys: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function enumerateMonthKeys(start: Date, endInclusive: Date): string[] {
  const keys: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), 1));
  while (cur <= last && keys.length < 24) {
    keys.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return keys;
}

export function resolvePilotageRange(
  params: { range?: string; from?: string; to?: string },
  now = new Date(),
): ResolvedPilotageRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (params.from && params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.from) && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
    const s = new Date(`${params.from}T00:00:00.000Z`);
    const eInclusive = new Date(`${params.to}T00:00:00.000Z`);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(eInclusive.getTime()) && eInclusive >= s) {
      const end = new Date(eInclusive.getTime() + DAY_MS);
      const totalDays = Math.max(1, Math.round((end.getTime() - s.getTime()) / DAY_MS));
      const elapsedDays = Math.max(1, Math.min(totalDays, Math.ceil((now.getTime() - s.getTime()) / DAY_MS)));
      return {
        key: "custom",
        label: `${params.from} → ${params.to}`,
        start: s,
        end,
        fromInput: params.from,
        toInput: params.to,
        totalDays,
        elapsedDays,
        monthKeys: enumerateMonthKeys(s, eInclusive),
      };
    }
  }

  const key: PilotageRangeKey =
    params.range === "week" ? "week" : params.range === "quarter" ? "quarter" : params.range === "year" ? "year" : "month";

  let start: Date;
  let end: Date;
  let label: string;

  if (key === "week") {
    const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
    start = new Date(Date.UTC(y, m, now.getUTCDate() - dow));
    end = new Date(start.getTime() + 7 * DAY_MS);
    label = "Cette semaine";
  } else if (key === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    start = new Date(Date.UTC(y, qStartMonth, 1));
    end = new Date(Date.UTC(y, qStartMonth + 3, 1));
    label = `Trimestre T${Math.floor(m / 3) + 1} ${y}`;
  } else if (key === "year") {
    start = new Date(Date.UTC(y, 0, 1));
    end = new Date(Date.UTC(y + 1, 0, 1));
    label = `Année ${y}`;
  } else {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 1));
    label = `Mois ${y}-${String(m + 1).padStart(2, "0")}`;
  }

  const endInclusive = new Date(end.getTime() - DAY_MS);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  const elapsedDays = Math.max(1, Math.min(totalDays, Math.ceil((now.getTime() - start.getTime()) / DAY_MS)));

  return {
    key,
    label,
    start,
    end,
    fromInput: isoDate(start),
    toInput: isoDate(endInclusive),
    totalDays,
    elapsedDays,
    monthKeys: enumerateMonthKeys(start, endInclusive),
  };
}

export function computePaceProjection(realized: number, elapsedDays: number, totalDays: number): number {
  if (elapsedDays <= 0 || totalDays <= 0) return Math.round(realized * 100) / 100;
  return Math.round(((realized / elapsedDays) * totalDays) * 100) / 100;
}

export function computeDealAgeDays(createdAt: Date, now = new Date()): number {
  const diff = Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS);
  return Math.max(0, diff);
}

const FUNNEL_STAGES: OpportunityStage[] = [
  "A_CONTACTER",
  "CONTACTE",
  "R1_PROGRAMME",
  "R1_EFFECTUE",
  "DEVIS_ENVOYE",
  "SIGNE",
  "ENCAISSE",
];

export type FunnelStep = {
  stage: OpportunityStage;
  label: string;
  count: number;
  rateFromPrev: number | null;
};

export function computeStageConversions(counts: Partial<Record<OpportunityStage, number>>): FunnelStep[] {
  return FUNNEL_STAGES.map((stage, idx) => {
    const count = counts[stage] ?? 0;
    const prevCount = idx > 0 ? (counts[FUNNEL_STAGES[idx - 1]] ?? 0) : null;
    const rateFromPrev = prevCount && prevCount > 0 ? Math.round((count / prevCount) * 100) : null;
    return {
      stage,
      label: STAGE_META_MAP[stage].label,
      count,
      rateFromPrev,
    };
  });
}

export type DealReconciliationInput = {
  id: string;
  salonId: string;
  salonName: string;
  ownerName: string;
  mrrSignedEur: number;
  collectedEur: number;
  hasRefundOrDispute: boolean;
};

export type DealReconciliationRow = DealReconciliationInput & {
  deltaEur: number;
  status: "OK" | "UNPAID" | "UNDERPAID" | "OVERPAID" | "REFUNDED_OR_DISPUTED";
};

export function reconcileDealMrr(deals: DealReconciliationInput[]): DealReconciliationRow[] {
  return deals.map((d) => {
    const deltaEur = Math.round((d.collectedEur - d.mrrSignedEur) * 100) / 100;
    let status: DealReconciliationRow["status"] = "OK";
    if (d.hasRefundOrDispute) {
      status = "REFUNDED_OR_DISPUTED";
    } else if (d.mrrSignedEur > 0 && d.collectedEur <= 0) {
      status = "UNPAID";
    } else if (deltaEur < -1) {
      status = "UNDERPAID";
    } else if (deltaEur > 1) {
      status = "OVERPAID";
    }
    return { ...d, deltaEur, status };
  });
}
