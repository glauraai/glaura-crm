import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { isManagerOrAdmin, requireMember } from "@/lib/access";
import { getAssignableUsers } from "@/lib/salons";
import {
  computeDealAgeDays,
  computePaceProjection,
  computeStageConversions,
  reconcileDealMrr,
  resolvePilotageRange,
} from "@/lib/pilotage/metrics";
import { STAGE_META_MAP } from "@/lib/pipeline/stages";
import { DEFAULT_PLAN_RULES } from "@/lib/commissions/engine";
import { frenchDate } from "@/lib/crm-format";
import { cn } from "@/lib/utils";
import type { OpportunityStage } from "@/generated/prisma/enums";

const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";

const RECON_BADGE: Record<string, { label: string; style: string }> = {
  OK: { label: "Aligné", style: "bg-emerald-100 text-emerald-800" },
  UNPAID: { label: "Non encaissé", style: "bg-rose-100 text-rose-700" },
  UNDERPAID: { label: "Écart négatif", style: "bg-amber-100 text-amber-800" },
  OVERPAID: { label: "Sur-encaissé", style: "bg-sky-100 text-sky-800" },
  REFUNDED_OR_DISPUTED: { label: "Litige / Remb.", style: "bg-rose-600 text-white" },
};

export default async function PilotagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireMember();
  if (!isManagerOrAdmin(user)) redirect("/dashboard");
  const admin = true;
  const sp = await searchParams;
  const now = new Date();
  const range = resolvePilotageRange({ range: sp.range, from: sp.from, to: sp.to }, now);
  const selectedRepId = admin ? sp.rep || undefined : user.id;

  const [users, activities, transcripts, transitions, quotes, completedTasks, opportunities, goals, invoices] = await Promise.all([
    admin ? getAssignableUsers() : prisma.user.findMany({ where: { id: user.id }, select: { id: true, name: true, email: true } }),
    prisma.activity.findMany({
      where: { createdAt: { gte: range.start, lt: range.end }, ...(selectedRepId ? { userId: selectedRepId } : {}) },
      select: { userId: true, type: true, isDecisionMakerCall: true },
    }),
    prisma.transcriptRecord.findMany({
      where: { occurredAt: { gte: range.start, lt: range.end }, ...(selectedRepId ? { userId: selectedRepId } : {}) },
      select: { userId: true, callResult: true, isDecisionMakerCall: true },
    }),
    prisma.stageTransition.findMany({
      where: {
        createdAt: { gte: range.start, lt: range.end },
        ...(selectedRepId ? { opportunity: { ownerId: selectedRepId } } : {}),
      },
      select: { toStage: true, opportunity: { select: { ownerId: true } } },
    }),
    prisma.subscriptionLine.findMany({
      where: { createdAt: { gte: range.start, lt: range.end }, ...(selectedRepId ? { createdById: selectedRepId } : {}) },
      select: { createdById: true },
    }),
    prisma.salesTask.findMany({
      where: { doneAt: { gte: range.start, lt: range.end }, ...(selectedRepId ? { assignedToId: selectedRepId } : {}) },
      select: { assignedToId: true },
    }),
    prisma.opportunity.findMany({
      where: { salon: { archivedAt: null }, ...(selectedRepId ? { ownerId: selectedRepId } : {}) },
      include: {
        salon: { select: { id: true, name: true, activatedAt: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.salesGoal.findMany({
      where: { periodKey: { in: range.monthKeys }, ...(selectedRepId ? { userId: selectedRepId } : {}) },
    }),
    prisma.syncedInvoice.findMany({
      where: { paidAt: { gte: range.start, lt: range.end } },
      select: { salonId: true, amountPaidCents: true, status: true, refunded: true, disputed: true },
    }),
  ]);

  // 1. Per-rep Activity matrix
  const repRows = (selectedRepId ? users.filter((u) => u.id === selectedRepId) : users).map((rep) => {
    const repActs = activities.filter((a) => a.userId === rep.id);
    const repTr = transcripts.filter((t) => t.userId === rep.id);
    const repTransitions = transitions.filter((t) => t.opportunity.ownerId === rep.id);
    const callsMade = repActs.filter((a) => a.type === "APPEL").length + repTr.length;
    const callsAnswered = repTr.filter((t) => t.callResult === "ANSWERED").length + repActs.filter((a) => a.type === "APPEL").length;
    const dmCalls = repActs.filter((a) => a.isDecisionMakerCall).length;
    const rdvScheduled = repTransitions.filter((t) => t.toStage === "R1_PROGRAMME").length;
    const rdvHeld = repTransitions.filter((t) => t.toStage === "R1_EFFECTUE").length;
    const quotesSent = quotes.filter((q) => q.createdById === rep.id).length;
    const relancesDone =
      completedTasks.filter((t) => t.assignedToId === rep.id).length +
      repActs.filter((a) => a.type === "RELANCE").length;

    const repSignedOpps = opportunities.filter(
      (o) =>
        o.ownerId === rep.id &&
        ["SIGNE", "ABONNE", "COMPTE_ACTIVE", "ENCAISSE"].includes(o.stage) &&
        o.signedAt &&
        o.signedAt >= range.start &&
        o.signedAt < range.end,
    );
    const signedMrr = repSignedOpps.reduce((s, o) => s + (o.monthlyAmountEur ?? 0), 0);
    const repGoals = goals.filter((g) => g.userId === rep.id);
    const targetMrr =
      repGoals.length > 0
        ? repGoals.reduce((s, g) => s + g.targetMrrEur, 0)
        : DEFAULT_PLAN_RULES.standardTargetEur * Math.max(1, range.monthKeys.length);

    return {
      rep,
      callsMade,
      callsAnswered,
      dmCalls,
      rdvScheduled,
      rdvHeld,
      quotesSent,
      relancesDone,
      signedMrr,
      targetMrr,
      projectedMrr: computePaceProjection(signedMrr, range.elapsedDays, range.totalDays),
    };
  });

  // 2. Results & Deal-by-Deal Reconciliation
  const stageCounts: Partial<Record<OpportunityStage, number>> = {};
  for (const t of transitions) {
    stageCounts[t.toStage] = (stageCounts[t.toStage] ?? 0) + 1;
  }
  const funnel = computeStageConversions(stageCounts);

  const signedInPeriod = opportunities.filter(
    (o) =>
      ["SIGNE", "ABONNE", "COMPTE_ACTIVE", "ENCAISSE"].includes(o.stage) &&
      ((o.signedAt && o.signedAt >= range.start && o.signedAt < range.end) ||
        (!o.signedAt && o.updatedAt >= range.start && o.updatedAt < range.end)),
  );
  const activatedCount = signedInPeriod.filter((o) => o.stage === "COMPTE_ACTIVE" || o.stage === "ENCAISSE" || o.salon.activatedAt != null).length;

  const invoiceBySalon = new Map<string, { paidEur: number; issue: boolean }>();
  for (const inv of invoices) {
    if (!inv.salonId) continue;
    const prev = invoiceBySalon.get(inv.salonId) ?? { paidEur: 0, issue: false };
    if (inv.status === "paid" && !inv.refunded && !inv.disputed) {
      prev.paidEur += inv.amountPaidCents / 100;
    }
    if (inv.refunded || inv.disputed) prev.issue = true;
    invoiceBySalon.set(inv.salonId, prev);
  }

  const reconciliation = reconcileDealMrr(
    signedInPeriod.map((o) => {
      const inv = invoiceBySalon.get(o.salonId) ?? { paidEur: 0, issue: false };
      return {
        id: o.id,
        salonId: o.salon.id,
        salonName: o.salon.name,
        ownerName: o.owner?.name ?? o.owner?.email ?? "Non attribué",
        mrrSignedEur: o.monthlyAmountEur ?? 0,
        collectedEur: Math.round(inv.paidEur * 100) / 100,
        hasRefundOrDispute: inv.issue,
      };
    }),
  );

  const totalSignedMrr = Math.round(reconciliation.reduce((s, r) => s + r.mrrSignedEur, 0) * 100) / 100;
  const totalCollectedEur = Math.round(reconciliation.reduce((s, r) => s + r.collectedEur, 0) * 100) / 100;
  const totalTargetMrr = Math.round(repRows.reduce((s, r) => s + r.targetMrr, 0) * 100) / 100;
  const totalProjectedMrr = computePaceProjection(totalSignedMrr, range.elapsedDays, range.totalDays);

  // 4. Open Deals with Age
  const openDeals = opportunities
    .filter((o) => !["ENCAISSE", "PERDU"].includes(o.stage))
    .map((o) => ({ ...o, ageDays: computeDealAgeDays(o.createdAt, now) }))
    .sort((a, b) => b.ageDays - a.ageDays);

  const presetHref = (nextRange: string) => {
    const qs = new URLSearchParams();
    qs.set("range", nextRange);
    if (admin && selectedRepId) qs.set("rep", selectedRepId);
    return `/pilotage?${qs}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-rose-600">Dashboard de pilotage · {range.label}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Pilotage commercial & résultats</h1>
          <p className="mt-1 text-sm text-slate-500">
            Activité, rapprochement MRR signé / encaissé deal par deal, atteinte des objectifs avec projection et deals en cours ({range.elapsedDays}/{range.totalDays} jours écoulés).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/pipeline" className={input}>Pipeline →</Link>
          <Link href="/remuneration" className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white">Commissions & Paie →</Link>
        </div>
      </header>

      {/* Filters: presets + dates libres + commercial */}
      <section className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-1.5">
          {([["week", "Semaine"], ["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"]] as const).map(([key, label]) => (
            <Link
              key={key}
              href={presetHref(key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium",
                range.key === key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {label}
            </Link>
          ))}
        </div>

        <form action="/pilotage" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">
            Du
            <input type="date" name="from" defaultValue={range.fromInput} className={`${input} ml-1.5`} />
          </label>
          <label className="text-xs text-slate-500">
            Au
            <input type="date" name="to" defaultValue={range.toInput} className={`${input} ml-1.5`} />
          </label>
          {admin && (
            <select name="rep" defaultValue={selectedRepId ?? ""} className={input}>
              <option value="">Toute l’équipe</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
            </select>
          )}
          <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">Appliquer</button>
        </form>
      </section>

      {/* Block 3: Atteinte des objectifs & projection */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">MRR signé / Objectif</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-950">{totalSignedMrr.toLocaleString("fr-FR")} €</p>
          <p className="text-xs text-slate-500">Objectif : {totalTargetMrr.toLocaleString("fr-FR")} € ({totalTargetMrr > 0 ? Math.round((totalSignedMrr / totalTargetMrr) * 100) : 0} %)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Projection fin de période</p>
          <p className="mt-1.5 text-2xl font-bold text-violet-700">{totalProjectedMrr.toLocaleString("fr-FR")} €</p>
          <p className="text-xs text-slate-500">Au rythme actuel ({range.elapsedDays}/{range.totalDays} j)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Encaissé Stripe</p>
          <p className="mt-1.5 text-2xl font-bold text-emerald-700">{totalCollectedEur.toLocaleString("fr-FR")} €</p>
          <p className="text-xs text-slate-500">Écart : {(totalCollectedEur - totalSignedMrr).toLocaleString("fr-FR")} €</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Abonnements signés</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-950">{signedInPeriod.length}</p>
          <p className="text-xs text-slate-500">{activatedCount} compte(s) activé(s)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Deals en cours</p>
          <p className="mt-1.5 text-2xl font-bold text-rose-700">{openDeals.length}</p>
          <p className="text-xs text-slate-500">
            Âge moyen : {openDeals.length > 0 ? Math.round(openDeals.reduce((s, d) => s + d.ageDays, 0) / openDeals.length) : 0} j
          </p>
        </div>
      </section>

      {/* Block 1: Activité par commercial */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-950">1. Activité & atteinte des objectifs par commercial</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {["Commercial", "Appels passés", "Aboutis", "Décideurs", "RDV prog.", "RDV eff.", "Devis", "Relances", "MRR signé / Obj.", "Projection"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {repRows.map((r) => (
                <tr key={r.rep.id}>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">{r.rep.name ?? r.rep.email}</td>
                  <td className="px-3 py-2.5">{r.callsMade}</td>
                  <td className="px-3 py-2.5">{r.callsAnswered}</td>
                  <td className="px-3 py-2.5 font-medium text-emerald-700">{r.dmCalls}</td>
                  <td className="px-3 py-2.5">{r.rdvScheduled}</td>
                  <td className="px-3 py-2.5">{r.rdvHeld}</td>
                  <td className="px-3 py-2.5">{r.quotesSent}</td>
                  <td className="px-3 py-2.5">{r.relancesDone}</td>
                  <td className="px-3 py-2.5 text-xs font-medium">
                    {r.signedMrr.toLocaleString("fr-FR")} € / {r.targetMrr.toLocaleString("fr-FR")} €
                    <span className="ml-1 text-slate-500">({r.targetMrr > 0 ? Math.round((r.signedMrr / r.targetMrr) * 100) : 0} %)</span>
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-violet-700">{r.projectedMrr.toLocaleString("fr-FR")} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Block 2: Résultats — Funnel + Rapprochement deal par deal */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div>
          <h2 className="mb-3 text-base font-semibold text-slate-950">2. Résultats — Taux de conversion entre stades</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {funnel.map((step) => (
              <div key={step.stage} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-medium text-slate-500">{step.label}</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{step.count}</p>
                <p className="text-[11px] text-emerald-700">{step.rateFromPrev != null ? `${step.rateFromPrev} % vs préc.` : "Entrée"}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Rapprochement MRR signé (CRM) vs encaissé (Stripe) — deal par deal</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {["Salon", "Commercial", "MRR signé (CRM)", "Encaissé (Stripe)", "Écart", "Statut"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliation.map((r) => {
                  const badge = RECON_BADGE[r.status];
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/salons/${r.salonId}`} className="font-semibold text-slate-900 hover:text-rose-600">{r.salonName}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{r.ownerName}</td>
                      <td className="px-3 py-2.5 font-medium">{r.mrrSignedEur.toLocaleString("fr-FR")} €</td>
                      <td className="px-3 py-2.5 font-medium text-emerald-700">{r.collectedEur.toLocaleString("fr-FR")} €</td>
                      <td className={cn("px-3 py-2.5 font-semibold", r.deltaEur < 0 ? "text-rose-700" : "text-slate-700")}>
                        {r.deltaEur > 0 ? `+${r.deltaEur}` : r.deltaEur} €
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", badge.style)}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {reconciliation.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Aucun deal signé sur cette période.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Block 4: Deals en cours avec âge */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-950">3. Deals en cours (pipeline par stade & âge)</h2>
          <Link href="/pipeline" className="text-xs font-medium text-rose-700 hover:underline">Ouvrir le Kanban →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {["Salon & Deal", "Stade", "MRR", "Âge", "Prochaine étape & date", "Commercial"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {openDeals.slice(0, 40).map((d) => {
                const meta = STAGE_META_MAP[d.stage];
                return (
                  <tr key={d.id}>
                    <td className="px-3 py-2.5">
                      <Link href={`/salons/${d.salon.id}`} className="font-semibold text-slate-900 hover:text-rose-600">{d.salon.name}</Link>
                      <p className="text-xs text-slate-500">{d.title}</p>
                    </td>
                    <td className="px-3 py-2.5"><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", meta.badgeClass)}>{meta.label}</span></td>
                    <td className="px-3 py-2.5 font-medium">{d.monthlyAmountEur ? `${d.monthlyAmountEur} €` : "—"}</td>
                    <td className={cn("px-3 py-2.5 text-xs font-semibold", d.ageDays >= 14 ? "text-amber-700" : "text-slate-600")}>J+{d.ageDays}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {d.nextStep ?? "Aucune"}
                      {d.nextStepAt && <span className="ml-1 text-slate-400">({frenchDate(d.nextStepAt)})</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{d.owner?.name ?? d.owner?.email ?? "Non attribué"}</td>
                  </tr>
                );
              })}
              {openDeals.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Aucun deal en cours.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
