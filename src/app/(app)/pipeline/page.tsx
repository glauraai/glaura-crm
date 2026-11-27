import Link from "next/link";
import { prisma } from "@/lib/db";
import { isManagerOrAdmin, requireMember } from "@/lib/access";
import { getAssignableUsers } from "@/lib/salons";
import { moveOpportunityStage, reassignOpportunity } from "@/lib/pipeline/actions";
import { OPPORTUNITY_STAGES, STAGE_META_MAP } from "@/lib/pipeline/stages";
import { computeDealAgeDays } from "@/lib/pilotage/metrics";
import { frenchDate } from "@/lib/crm-format";
import { SubmitButton } from "@/components/SubmitButton";
import { cn } from "@/lib/utils";

const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireMember();
  const admin = isManagerOrAdmin(user);
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "kanban";
  const ownerFilter = admin ? sp.owner : user.id;
  const now = new Date();

  const where = {
    salon: { archivedAt: null },
    ...(ownerFilter ? { ownerId: ownerFilter } : {}),
  };

  const [opportunities, users] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        salon: { select: { id: true, name: true, arrondissement: true, bookingTool: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
      take: 300,
    }),
    admin ? getAssignableUsers() : Promise.resolve([]),
  ]);

  const byStage = new Map<string, typeof opportunities>();
  for (const s of OPPORTUNITY_STAGES) byStage.set(s.stage, []);
  for (const opp of opportunities) {
    byStage.get(opp.stage)?.push(opp);
  }

  const totalMrr = opportunities
    .filter((o) => o.stage !== "PERDU")
    .reduce((sum, o) => sum + (o.monthlyAmountEur ?? 0), 0);

  const viewHref = (nextView: "kanban" | "list") => {
    const qs = new URLSearchParams();
    qs.set("view", nextView);
    if (admin && ownerFilter) qs.set("owner", ownerFilter);
    return `/pipeline?${qs}`;
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-rose-600">Cycle de vente · 13 stades horodatés</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Pipeline commercial</h1>
          <p className="mt-1 text-sm text-slate-500">
            {opportunities.length} opportunité(s) · MRR pipeline actif :{" "}
            <strong className="text-slate-900">{Math.round(totalMrr).toLocaleString("fr-FR")} € HT/mois</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={viewHref("kanban")} className={cn("rounded-lg px-3 py-2 text-sm font-medium", view === "kanban" ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}>
            Vue colonnes
          </Link>
          <Link href={viewHref("list")} className={cn("rounded-lg px-3 py-2 text-sm font-medium", view === "list" ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}>
            Vue liste
          </Link>
          <Link href="/tarifs" className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">
            Tarifs & Devis →
          </Link>
        </div>
      </header>

      {sp.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{sp.error}</p>}

      {admin && (
        <form action="/pipeline" className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="view" value={view} />
          <select name="owner" defaultValue={ownerFilter ?? ""} className={input}>
            <option value="">Toute l’équipe</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </select>
          <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white">Filtrer</button>
        </form>
      )}

      {view === "kanban" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {OPPORTUNITY_STAGES.map((meta) => {
            const items = byStage.get(meta.stage) ?? [];
            const colMrr = items.reduce((s, o) => s + (o.monthlyAmountEur ?? 0), 0);
            return (
              <section key={meta.stage} className="flex w-72 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-100/70 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.badgeClass)}>
                      {meta.label}
                    </span>
                    <p className="mt-1 text-[11px] text-slate-500">{meta.phase}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{items.length}</p>
                    {colMrr > 0 && <p className="text-[11px] text-slate-500">{Math.round(colMrr)} €/m</p>}
                  </div>
                </div>

                <div className="space-y-2.5">
                  {items.map((opp) => (
                    <article key={opp.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/salons/${opp.salon.id}`} className="text-sm font-semibold text-slate-900 hover:text-rose-600">
                          {opp.salon.name}
                        </Link>
                        {opp.atRisk && (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700" title={opp.riskReason ?? "À risque"}>
                            Risque
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{opp.title}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600">
                        <span className="font-medium text-emerald-700">
                          {opp.monthlyAmountEur ? `${opp.monthlyAmountEur} € HT/m` : "MRR à préciser"}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          J+{computeDealAgeDays(opp.createdAt, now)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{opp.owner?.name ?? opp.owner?.email ?? "Non attribué"}</p>
                      {opp.nextStep && <p className="mt-1.5 truncate text-xs text-slate-600">→ {opp.nextStep}</p>}
                      {opp.lossReason && <p className="mt-1 text-xs text-rose-600">Motif : {opp.lossReason}</p>}

                      <form action={moveOpportunityStage} className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2">
                        <input type="hidden" name="opportunityId" value={opp.id} />
                        <input type="hidden" name="returnTo" value={viewHref("kanban")} />
                        <div className="flex gap-1.5">
                          <select name="stage" defaultValue={opp.stage} className="h-8 flex-1 rounded border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800">
                            {OPPORTUNITY_STAGES.map((s) => (
                              <option key={s.stage} value={s.stage}>{s.label}</option>
                            ))}
                          </select>
                          <SubmitButton className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700">
                            OK
                          </SubmitButton>
                        </div>
                        <input
                          name="lossReason"
                          placeholder="Motif si Perdu…"
                          className="h-7 w-full rounded border border-slate-200 px-2 text-[11px] text-slate-700"
                        />
                      </form>
                    </article>
                  ))}
                  {items.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Aucun deal</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {["Salon & Deal", "Stade", "MRR HT/mois", "Âge", "Prochaine étape", "Commercial", "Action"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {opportunities.map((opp) => {
                const meta = STAGE_META_MAP[opp.stage];
                const ageDays = computeDealAgeDays(opp.createdAt, now);
                return (
                  <tr key={opp.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <Link href={`/salons/${opp.salon.id}`} className="font-semibold text-slate-900 hover:text-rose-600">{opp.salon.name}</Link>
                      <p className="text-xs text-slate-500">{opp.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.badgeClass)}>{meta.label}</span>
                      {opp.ownerLockedAt && <p className="mt-1 text-[11px] text-emerald-700">Figé le {frenchDate(opp.ownerLockedAt)}</p>}
                    </td>
                    <td className="px-4 py-3 font-medium">{opp.monthlyAmountEur ? `${opp.monthlyAmountEur} €` : "—"}</td>
                    <td className={cn("px-4 py-3 text-xs font-semibold", ageDays >= 14 ? "text-amber-700" : "text-slate-600")}>J+{ageDays}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {opp.nextStep ?? "—"}
                      {opp.nextStepAt && <span className="block text-slate-400">{frenchDate(opp.nextStepAt)}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-medium text-slate-800">{opp.owner?.name ?? opp.owner?.email ?? "Non attribué"}</p>
                      {admin && (
                        <form action={reassignOpportunity} className="mt-1.5 flex flex-wrap gap-1">
                          <input type="hidden" name="opportunityId" value={opp.id} />
                          <select name="toUserId" defaultValue={opp.ownerId ?? ""} className="h-7 rounded border border-slate-200 px-1.5 text-[11px]">
                            {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
                          </select>
                          <input name="reason" required placeholder="Motif…" className="h-7 w-28 rounded border border-slate-200 px-1.5 text-[11px]" />
                          <SubmitButton className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-white">Réattribuer</SubmitButton>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <form action={moveOpportunityStage} className="flex flex-wrap gap-1.5">
                        <input type="hidden" name="opportunityId" value={opp.id} />
                        <input type="hidden" name="returnTo" value={viewHref("list")} />
                        <select name="stage" defaultValue={opp.stage} className="h-8 rounded border border-slate-200 px-2 text-xs">
                          {OPPORTUNITY_STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.label}</option>)}
                        </select>
                        <input name="lossReason" placeholder="Motif si Perdu" className="h-8 w-32 rounded border border-slate-200 px-2 text-xs" />
                        <SubmitButton className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">OK</SubmitButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
