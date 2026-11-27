import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireMember } from "@/lib/access";
import { getAssignableUsers } from "@/lib/salons";
import {
  DEFAULT_PLAN_RULES,
  calculateMonthlyPayroll,
  isDisputeWindowOpen,
  monthKeyForDate,
} from "@/lib/commissions/engine";
import {
  raiseCommissionDispute,
  resolveCommissionDispute,
  saveSalesGoal,
  triggerBillingSync,
} from "@/lib/commissions/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { frenchDate } from "@/lib/crm-format";

const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";

const STATUS_LABEL: Record<string, string> = {
  PREVUE: "Prévue (signée)",
  EN_VALIDATION: "En validation (1re facture)",
  ACQUISE: "Acquise (2 factures / annuel)",
  VERSEE: "Versée",
  PERDUE: "Perdue avant validation",
  ARRETEE: "Arrêtée",
};

export default async function RemunerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireMember();
  const admin = user.role === "ADMIN";
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : monthKeyForDate();
  const selectedRepId = admin ? (sp.rep || user.id) : user.id;

  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));

  const [users, allMonthCommissions, allMonthGoals, dmCallsByUser, meetingsByUser, openDisputes, collectedInvoices, auditLogs] = await Promise.all([
    admin ? getAssignableUsers() : Promise.resolve([]),
    prisma.commission.findMany({
      where: { signedMonth: month, ...(admin ? {} : { ownerId: user.id }) },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        planVersion: true,
        opportunity: { include: { salon: { select: { id: true, name: true } } } },
        disputes: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.salesGoal.findMany({
      where: { periodKey: month, ...(admin ? {} : { userId: user.id }) },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { isDecisionMakerCall: true, createdAt: { gte: monthStart, lt: monthEnd }, ...(admin ? {} : { userId: user.id }) },
      _count: { _all: true },
    }),
    prisma.stageTransition.findMany({
      where: {
        toStage: "R1_PROGRAMME",
        createdAt: { gte: monthStart, lt: monthEnd },
        ...(admin ? {} : { opportunity: { ownerId: user.id } }),
      },
      select: { opportunity: { select: { ownerId: true } } },
    }),
    admin
      ? prisma.commissionDispute.findMany({
          include: {
            raisedBy: { select: { name: true, email: true } },
            resolvedBy: { select: { name: true, email: true } },
            commission: { include: { opportunity: { include: { salon: { select: { name: true } } } } } },
          },
          orderBy: { createdAt: "desc" },
          take: 25,
        })
      : Promise.resolve([]),
    prisma.syncedInvoice.aggregate({
      where: { status: "paid", refunded: false, disputed: false, paidAt: { gte: monthStart, lt: monthEnd } },
      _sum: { amountPaidCents: true },
    }),
    admin
      ? prisma.ownershipAuditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { opportunity: { include: { salon: { select: { name: true } } } } },
        })
      : Promise.resolve([]),
  ]);

  const dmCountMap = new Map(dmCallsByUser.map((r) => [r.userId ?? "", r._count._all]));
  const meetingCountMap = new Map<string, number>();
  for (const m of meetingsByUser) {
    const id = m.opportunity.ownerId ?? "";
    meetingCountMap.set(id, (meetingCountMap.get(id) ?? 0) + 1);
  }
  const goalMap = new Map(allMonthGoals.map((g) => [g.userId, g]));
  const commissions = allMonthCommissions;
  const goal = goalMap.get(selectedRepId) ?? null;
  const dmCallsCount = dmCountMap.get(selectedRepId) ?? 0;
  const meetingsCount = meetingCountMap.get(selectedRepId) ?? 0;

  const teamComparison = admin
    ? users.map((u) => {
        const uDeals = allMonthCommissions.filter((c) => c.ownerId === u.id);
        const uGoal = goalMap.get(u.id);
        const uPayroll = calculateMonthlyPayroll({
          targetMrrEur: uGoal?.targetMrrEur ?? DEFAULT_PLAN_RULES.standardTargetEur,
          isRampMonth: uGoal?.isRampMonth ?? false,
          dmCallsCount: dmCountMap.get(u.id) ?? 0,
          meetingsCount: meetingCountMap.get(u.id) ?? 0,
          deals: uDeals.map((d) => ({ id: d.id, mrrSignedEur: d.mrrSignedEur, cadence: d.cadence, discountPercent: d.discountPercent, status: d.status })),
          rules: DEFAULT_PLAN_RULES,
        });
        return { user: u, dealCount: uDeals.length, payroll: uPayroll };
      })
    : [];

  const repDeals = commissions.filter((c) => c.ownerId === selectedRepId);
  const rules = repDeals[0]?.planVersion
    ? {
        ...DEFAULT_PLAN_RULES,
        baseRate: repDeals[0].planVersion.baseRate,
        accel2Threshold: repDeals[0].planVersion.accel2Threshold,
        accel2Multiplier: repDeals[0].planVersion.accel2Multiplier,
        accel3Threshold: repDeals[0].planVersion.accel3Threshold,
        accel3Multiplier: repDeals[0].planVersion.accel3Multiplier,
        guaranteeEur: repDeals[0].planVersion.guaranteeEur,
        guaranteeMinDmCalls: repDeals[0].planVersion.guaranteeMinDmCalls,
        guaranteeMinMeetings: repDeals[0].planVersion.guaranteeMinMeetings,
      }
    : DEFAULT_PLAN_RULES;

  const payroll = calculateMonthlyPayroll({
    targetMrrEur: goal?.targetMrrEur ?? DEFAULT_PLAN_RULES.standardTargetEur,
    isRampMonth: goal?.isRampMonth ?? false,
    dmCallsCount,
    meetingsCount,
    deals: repDeals.map((d) => ({
      id: d.id,
      mrrSignedEur: d.mrrSignedEur,
      cadence: d.cadence,
      discountPercent: d.discountPercent,
      status: d.status,
    })),
    rules,
  });

  const paidOrAcquired = repDeals.filter((d) => ["ACQUISE", "VERSEE", "ARRETEE"].includes(d.status));
  const pendingValidation = repDeals.filter((d) => ["PREVUE", "EN_VALIDATION"].includes(d.status));
  const lostDeals = repDeals.filter((d) => d.status === "PERDUE");
  const totalCollectedEur = Math.round(((collectedInvoices._sum.amountPaidCents ?? 0) / 100) * 100) / 100;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-rose-600">Plan de rémunération · taux 0,7716 · accélérateurs ×2 / ×3</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
            {admin ? "Commissions & Export Paie" : "Ma rémunération"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Mêmes chiffres pour le commercial et Fodé, calculés depuis les deals signés et les factures Stripe vérifiées.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action="/remuneration" className="flex items-center gap-2">
            <input type="month" name="month" defaultValue={month} className={input} />
            {admin && (
              <select name="rep" defaultValue={selectedRepId} className={input}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
              </select>
            )}
            <button className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white">Afficher</button>
          </form>
          {admin && (
            <>
              <form action={triggerBillingSync}>
                <SubmitButton className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Synchroniser Stripe
                </SubmitButton>
              </form>
              <a
                href={`/api/commissions/export?month=${encodeURIComponent(month)}`}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Exporter paie CSV ↓
              </a>
            </>
          )}
        </div>
      </header>

      {sp.notice && <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{sp.notice}</p>}
      {sp.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{sp.error}</p>}

      {/* Main KPI cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">MRR signé ({month})</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">
            {payroll.validMrrEur.toLocaleString("fr-FR")} €
            <span className="text-sm font-normal text-slate-500"> / {payroll.targetMrrEur.toLocaleString("fr-FR")} €</span>
          </p>
          <p className="mt-1 text-xs font-medium text-rose-600">{Math.round(payroll.attainmentRatio * 100)} % de l’objectif</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Palier d’accélérateur</p>
          <p className="mt-2 text-2xl font-bold text-violet-700">×{payroll.currentMultiplier}</p>
          <p className="mt-1 text-xs text-slate-500">
            {payroll.mrrToNextTierEur != null ? `Encore ${payroll.mrrToNextTierEur.toLocaleString("fr-FR")} € pour le palier suivant` : "Palier maximal ×3 atteint"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Variable projeté / à verser</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{payroll.payableEur.toLocaleString("fr-FR")} €</p>
          <p className="mt-1 text-xs text-slate-500">
            {payroll.guaranteeApplied ? "Garantie M1/M2 (1 250 €) appliquée" : `Commissions calculées : ${payroll.earnedCommissionEur.toLocaleString("fr-FR")} €`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {admin ? "Encaissé Stripe (global mois)" : "Garantie M1/M2 (compteurs)"}
          </p>
          {admin ? (
            <>
              <p className="mt-2 text-2xl font-bold text-slate-950">{totalCollectedEur.toLocaleString("fr-FR")} €</p>
              <p className="mt-1 text-xs text-slate-500">Factures Stripe payées hors remboursements/litiges</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-semibold text-slate-900">Décideurs : {dmCallsCount} / {rules.guaranteeMinDmCalls}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">RDV pris : {meetingsCount} / {rules.guaranteeMinMeetings}</p>
            </>
          )}
        </div>
      </section>

      {/* Admin: Team-wide side-by-side comparison */}
      {admin && teamComparison.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-base font-semibold text-slate-950">Comparaison de l’équipe ({month})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {["Commercial", "Deals", "MRR signé", "Objectif", "Atteinte", "Palier", "Variable à verser"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamComparison.map((row) => (
                  <tr key={row.user.id} className={row.user.id === selectedRepId ? "bg-rose-50/40" : ""}>
                    <td className="px-3 py-2.5">
                      <Link href={`/remuneration?month=${month}&rep=${row.user.id}`} className="font-semibold text-slate-900 hover:text-rose-600">
                        {row.user.name ?? row.user.email}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{row.dealCount}</td>
                    <td className="px-3 py-2.5 font-medium">{row.payroll.validMrrEur.toLocaleString("fr-FR")} €</td>
                    <td className="px-3 py-2.5 text-slate-500">{row.payroll.targetMrrEur.toLocaleString("fr-FR")} €</td>
                    <td className="px-3 py-2.5 font-medium">{Math.round(row.payroll.attainmentRatio * 100)} %</td>
                    <td className="px-3 py-2.5 font-semibold text-violet-700">×{row.payroll.currentMultiplier}</td>
                    <td className="px-3 py-2.5 font-bold text-emerald-700">
                      {row.payroll.payableEur.toLocaleString("fr-FR")} €
                      {row.payroll.guaranteeApplied && <span className="ml-1 text-[11px] font-normal text-slate-500">(garantie)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 3-block monthly statement */}
      {[
        ["Commissions acquises & versées", paidOrAcquired, "border-emerald-200"],
        ["En validation (en attente 2e facture / paiement)", pendingValidation, "border-amber-200"],
        ["Perdues avant validation", lostDeals, "border-rose-200"],
      ].map(([title, list, borderClass]) => {
        const items = list as typeof repDeals;
        return (
          <section key={String(title)} className={`rounded-xl border bg-white p-5 ${String(borderClass)}`}>
            <h2 className="mb-3 text-base font-semibold text-slate-950">
              {String(title)} ({items.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    {["Salon", "Cadence", "MRR signé", "Factures payées", "Commission", "Statut", "Contestation (15 j)"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((c) => {
                    const finalAmt = payroll.perDealFinalEur[c.id] ?? c.finalAmountEur;
                    const canDispute = isDisputeWindowOpen(c.settledAt);
                    return (
                      <tr key={c.id}>
                        <td className="px-3 py-2.5">
                          <Link href={`/salons/${c.opportunity.salon.id}`} className="font-semibold text-slate-900 hover:text-rose-600">
                            {c.opportunity.salon.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{c.cadence}</td>
                        <td className="px-3 py-2.5 font-medium">{c.mrrSignedEur} €</td>
                        <td className="px-3 py-2.5 text-xs">{c.paidInvoicesCount}</td>
                        <td className="px-3 py-2.5 font-semibold text-emerald-700">{finalAmt.toLocaleString("fr-FR")} €</td>
                        <td className="px-3 py-2.5 text-xs">{STATUS_LABEL[c.status] ?? c.status}</td>
                        <td className="px-3 py-2.5">
                          {canDispute ? (
                            <form action={raiseCommissionDispute} className="flex gap-1.5">
                              <input type="hidden" name="commissionId" value={c.id} />
                              <input name="reason" required placeholder="Motif contestation…" className="h-7 w-40 rounded border border-slate-200 px-2 text-xs" />
                              <SubmitButton className="rounded bg-slate-800 px-2 py-1 text-[11px] text-white">Contester</SubmitButton>
                            </form>
                          ) : (
                            <span className="text-xs text-slate-400">Clos</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-5 text-center text-xs text-slate-400">Aucun deal dans ce bloc.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {/* Admin: Goals & Open Disputes */}
      {admin && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-950">Définir l’objectif mensuel ({month})</h2>
            <form action={saveSalesGoal} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="periodKey" value={month} />
              <label className="text-xs text-slate-600 sm:col-span-2">
                Commercial
                <select name="userId" defaultValue={selectedRepId} className={`${input} mt-1 w-full`}>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Objectif MRR (€)
                <input name="targetMrrEur" type="number" defaultValue={goal?.targetMrrEur ?? 1620} className={`${input} mt-1 w-full`} />
              </label>
              <label className="text-xs text-slate-600">
                Objectif RDV
                <input name="targetMeetings" type="number" defaultValue={goal?.targetMeetings ?? 40} className={`${input} mt-1 w-full`} />
              </label>
              <label className="text-xs text-slate-600">
                Objectif conversations décideurs
                <input name="targetDmCalls" type="number" defaultValue={goal?.targetDmCalls ?? 120} className={`${input} mt-1 w-full`} />
              </label>
              <label className="flex items-center gap-2 pt-4 text-xs text-slate-700">
                <input type="checkbox" name="isRampMonth" defaultChecked={goal?.isRampMonth ?? false} />
                Mois de garantie M1/M2 (1 250 €)
              </label>
              <div className="sm:col-span-2">
                <SubmitButton className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">
                  Enregistrer l’objectif
                </SubmitButton>
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-950">Journal des contestations ({openDisputes.length}) & réattributions ({auditLogs.length})</h2>
            <div className="mt-3 space-y-3">
              {openDisputes.map((d) => (
                <div key={d.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs">
                  <p className="font-semibold text-slate-900">
                    {d.commission.opportunity.salon.name} · {d.raisedBy.name ?? d.raisedBy.email} ({frenchDate(d.createdAt)}) · <span className="uppercase">{d.status}</span>
                  </p>
                  <p className="mt-1 text-slate-700">{d.reason}</p>
                  {d.resolutionNote && <p className="mt-1 text-emerald-800">Décision : {d.resolutionNote}</p>}
                  {d.status === "OPEN" && (
                    <form action={resolveCommissionDispute} className="mt-2 flex flex-wrap gap-1.5">
                      <input type="hidden" name="disputeId" value={d.id} />
                      <input name="resolutionNote" required placeholder="Décision / commentaire Fodé…" className="h-8 flex-1 rounded border border-slate-200 bg-white px-2 text-xs" />
                      <SubmitButton name="status" value="RESOLVED_ADJUSTED" className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white">Ajuster</SubmitButton>
                      <SubmitButton name="status" value="REJECTED" className="rounded bg-rose-600 px-2.5 py-1 text-xs font-medium text-white">Rejeter</SubmitButton>
                    </form>
                  )}
                </div>
              ))}
              {auditLogs.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Réattributions d’opportunités</p>
                  <ul className="space-y-1.5 text-xs text-slate-600">
                    {auditLogs.map((log) => (
                      <li key={log.id} className="rounded bg-slate-50 px-2.5 py-1.5">
                        <strong>{log.opportunity.salon.name}</strong> · {frenchDate(log.createdAt, true)} — {log.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {openDisputes.length === 0 && auditLogs.length === 0 && <p className="text-sm text-slate-400">Aucune contestation ni réattribution enregistrée.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
