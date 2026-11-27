"use client";

import { useMemo, useState } from "react";
import {
  GLAURA_PLANS,
  LAURA_OPTIONS,
  SYNC_OPTION_CENTS,
  calculateOfferPricing,
  formatEurCents,
} from "@/lib/pricing/catalog";
import type { BillingCadence } from "@/generated/prisma/enums";
import { createSubscriptionOffer } from "@/lib/pricing/actions";
import { SubmitButton } from "@/components/SubmitButton";

type SalonOption = {
  id: string;
  name: string;
  providerId: string | null;
};

export function PricingCalculator({
  salons,
  fixedSalon,
  returnTo,
}: {
  salons?: SalonOption[];
  fixedSalon?: SalonOption;
  returnTo?: string;
}) {
  const [salonId, setSalonId] = useState(fixedSalon?.id ?? salons?.[0]?.id ?? "");
  const [planCode, setPlanCode] = useState("salon_v3");
  const [cadence, setCadence] = useState<BillingCadence>("ANNUAL_1X");
  const [lauraChannels, setLauraChannels] = useState("none");
  const [syncIncluded, setSyncIncluded] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [generateStripeLink, setGenerateStripeLink] = useState(true);

  const selectedSalon = fixedSalon ?? salons?.find((s) => s.id === salonId);

  const pricing = useMemo(
    () =>
      calculateOfferPricing({
        planCode,
        cadence,
        lauraChannels: lauraChannels === "none" ? null : lauraChannels,
        syncIncluded,
        discountPercent,
      }),
    [planCode, cadence, lauraChannels, syncIncluded, discountPercent],
  );

  const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900";

  return (
    <form action={createSubscriptionOffer} className="space-y-4">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {fixedSalon ? (
        <input type="hidden" name="salonId" value={fixedSalon.id} />
      ) : (
        <label className="block text-sm font-medium text-slate-700">
          Salon concerné
          <select name="salonId" value={salonId} onChange={(e) => setSalonId(e.target.value)} required className={`${field} mt-1`}>
            {(salons ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.providerId ? "· Compte Glaura lié ✓" : "· Pas encore onboardé"}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Formule Glaura
          <select name="planCode" value={planCode} onChange={(e) => setPlanCode(e.target.value)} className={`${field} mt-1`}>
            {GLAURA_PLANS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} — {formatEurCents(p.monthlyHtCents)} HT/mois
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Mode de paiement
          <select name="cadence" value={cadence} onChange={(e) => setCadence(e.target.value as BillingCadence)} className={`${field} mt-1`}>
            <option value="ANNUAL_1X">Annuel en 1 fois (×10 · 2 mois offerts)</option>
            <option value="ANNUAL_3X">Annuel en 3 fois (×11 · 1 mois offert)</option>
            <option value="MONTHLY">Mensuel sans engagement annuel</option>
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Option Laura IA
          <select name="lauraChannels" value={lauraChannels} onChange={(e) => setLauraChannels(e.target.value)} className={`${field} mt-1`}>
            {LAURA_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label} {o.monthlyHtCents > 0 ? `(+${formatEurCents(o.monthlyHtCents)} HT/mois)` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Remise commerciale mensuelle (%)
          <input
            name="discountPercent"
            type="number"
            min={0}
            max={90}
            step={1}
            value={discountPercent}
            onChange={(e) => setDiscountPercent(Number(e.target.value) || 0)}
            disabled={cadence !== "MONTHLY"}
            className={`${field} mt-1 disabled:bg-slate-100 disabled:text-slate-400`}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-5 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="syncIncluded" checked={syncIncluded} onChange={(e) => setSyncIncluded(e.target.checked)} />
          Synchronisation Planity / Treatwell (+{formatEurCents(SYNC_OPTION_CENTS)} HT/mois · hors lien Stripe)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="generateStripeLink" checked={generateStripeLink} onChange={(e) => setGenerateStripeLink(e.target.checked)} />
          Générer un lien de paiement Stripe Checkout
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">MRR signé (commission)</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{pricing.mrrSignedEur.toLocaleString("fr-FR")} € HT/mois</p>
            {pricing.commissionDiscountFactor < 1 && (
              <p className="mt-0.5 text-xs text-amber-700">
                Remise &gt;10 % : commission pondérée à {Math.round(pricing.commissionDiscountFactor * 100)} %
              </p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {cadence === "ANNUAL_1X" ? "À régler aujourd’hui (annuel 1×)" : cadence === "ANNUAL_3X" ? "1re échéance (annuel 3×)" : "Mensualité nette"}
            </p>
            <p className="mt-1 text-xl font-semibold text-emerald-700">{formatEurCents(pricing.todayHtCents)} HT</p>
            <p className="text-xs text-slate-500">
              Soit {formatEurCents(pricing.todayTtcCents)} TTC (TVA 20 % : {formatEurCents(pricing.todayVatCents)})
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Avantages inclus</p>
            <p className="mt-1 text-xs font-medium text-slate-800">
              {pricing.freeMonths > 0 ? `${pricing.freeMonths} mois offert(s) la 1re année` : "Facturation mensuelle"}
            </p>
            {pricing.freeWebsiteIncluded && (
              <p className="mt-0.5 text-xs font-medium text-rose-700">Site personnalisé (500 €) offert</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {selectedSalon?.providerId ? "Compte Glaura lié : lien Stripe prêt" : "Préparez le compte Glaura pour activer le lien Stripe"}
            </p>
          </div>
        </div>
      </div>

      <SubmitButton className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">
        {generateStripeLink ? "Enregistrer le devis & générer le lien de paiement" : "Enregistrer le devis brouillon"}
      </SubmitButton>
    </form>
  );
}
