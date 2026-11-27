import Link from "next/link";
import { prisma } from "@/lib/db";
import { isManagerOrAdmin, requireMember } from "@/lib/access";
import { GLAURA_PLANS, LAURA_OPTIONS, SYNC_OPTION_CENTS, formatEurCents } from "@/lib/pricing/catalog";
import { PricingCalculator } from "@/components/PricingCalculator";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { frenchDate } from "@/lib/crm-format";

export default async function TarifsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireMember();
  const admin = isManagerOrAdmin(user);
  const sp = await searchParams;

  const [salons, recentOffers] = await Promise.all([
    prisma.salon.findMany({
      where: { archivedAt: null, ...(admin ? {} : { assignedToId: user.id }) },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, providerId: true },
      take: 150,
    }),
    prisma.subscriptionLine.findMany({
      where: admin ? {} : { salon: { assignedToId: user.id } },
      include: { salon: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-sm font-medium text-rose-600">Grille commerciale & encaissement Stripe</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Tarifs & Solutions de paiement</h1>
        <p className="mt-1 text-sm text-slate-500">
          Prix HT officiels, calcul automatique mensuel / annuel 1× (2 mois offerts) / annuel 3× (1 mois offert) et génération de lien Stripe Checkout.
        </p>
      </header>

      {sp.offerNotice && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{sp.offerNotice}</p>
      )}

      {/* Reference Catalog Cards */}
      <section className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {GLAURA_PLANS.map((plan) => (
          <div key={plan.code} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">{plan.targetSegment}</p>
            <h2 className="mt-1 text-base font-semibold text-slate-950">{plan.name}</h2>
            <p className="mt-2 text-2xl font-bold text-slate-950">
              {formatEurCents(plan.monthlyHtCents)}
              <span className="text-xs font-normal text-slate-500"> HT/mois</span>
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              Annuel 1× : {formatEurCents(plan.monthlyHtCents * 10)} HT · 3× : 3 × {formatEurCents(Math.round((plan.monthlyHtCents * 11) / 3))} HT
            </p>
            <ul className="mt-3 space-y-1 text-xs text-slate-600">
              {plan.highlights.map((h) => (
                <li key={h}>• {h}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Options reference */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-950">Options Laura IA & Synchronisation (HT/mois)</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {LAURA_OPTIONS.filter((o) => o.monthlyHtCents > 0).map((o) => (
              <li key={o.code} className="flex justify-between py-2">
                <span className="text-slate-700">{o.label}</span>
                <span className="font-semibold text-slate-950">{formatEurCents(o.monthlyHtCents)}</span>
              </li>
            ))}
            <li className="flex justify-between py-2">
              <span className="text-slate-700">Synchronisation Planity / Treatwell</span>
              <span className="font-semibold text-slate-950">{formatEurCents(SYNC_OPTION_CENTS)}</span>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-950">Solutions de paiement acceptées</h2>
          <ul className="mt-3 space-y-2.5 text-sm text-slate-700">
            <li><strong>Annuel 1× (Stripe Checkout) :</strong> total mensuel × 10 en une fois (2 mois offerts). Site personnalisé (500 €) offert dès Salon solo / équipe. Commission acquise immédiatement à l’encaissement.</li>
            <li><strong>Annuel 3× (Stripe Checkout) :</strong> total mensuel × 11 réparti sur 3 mensualités (1 mois offert). Site personnalisé offert. Commission acquise dès le 1er paiement.</li>
            <li><strong>Mensuel (Stripe récurrent) :</strong> facturation mensuelle HT + TVA 20 %. Remise &gt;10 % réduit la commission proportionnellement. Commission acquise après 2 factures consécutives payées.</li>
          </ul>
        </div>
      </section>

      {/* Interactive Calculator & Checkout Link Generator */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h2 className="mb-1 text-lg font-semibold text-slate-950">Simulateur de devis & Lien de paiement Stripe</h2>
        <p className="mb-4 text-sm text-slate-500">
          Crée une ligne d’abonnement sur la fiche salon, met à jour le MRR de l’opportunité et génère un lien Stripe Checkout via la passerelle Glaura.
        </p>
        {salons.length > 0 ? (
          <PricingCalculator salons={salons} returnTo="/tarifs" />
        ) : (
          <p className="text-sm text-slate-500">Aucun salon attribué pour générer un devis. Ajoutez d’abord un salon depuis la prospection.</p>
        )}
      </section>

      {/* Recent Quotes & Payment Links */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-950">Derniers devis & liens de paiement générés</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {["Salon", "Formule", "Cadence", "MRR catalogue", "Lien de paiement", "Date"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentOffers.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2.5">
                    <Link href={`/salons/${o.salon.id}`} className="font-semibold text-slate-900 hover:text-rose-600">{o.salon.name}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-700">
                    {o.label}
                    {o.lauraChannels ? ` + Laura (${o.lauraChannels})` : ""}
                    {o.syncIncluded ? " + Sync" : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{o.cadence === "ANNUAL_1X" ? "Annuel 1×" : o.cadence === "ANNUAL_3X" ? "Annuel 3×" : "Mensuel"}</td>
                  <td className="px-3 py-2.5 font-medium">{formatEurCents(o.listMonthlyCents)}/m</td>
                  <td className="px-3 py-2.5">
                    {o.checkoutUrl ? <CopyLinkButton url={o.checkoutUrl} label="Copier le lien Stripe" /> : <span className="text-xs text-slate-400">Brouillon</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{frenchDate(o.createdAt)}</td>
                </tr>
              ))}
              {recentOffers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">Aucun devis enregistré pour le moment.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
