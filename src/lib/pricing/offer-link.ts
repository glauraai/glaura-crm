import "server-only";
import type { BillingCadence } from "@/generated/prisma/enums";
import { getAuth } from "@/lib/firebase-admin";
import { GLAURA_PLANS } from "./catalog";

async function resolveBillingAdminToken(): Promise<string | null> {
  const staticToken = process.env.GLAURA_BILLING_ADMIN_TOKEN?.trim();
  if (staticToken) return staticToken;

  const webApiKey = process.env.FIREBASE_WEB_API_KEY?.trim();
  const adminUid = process.env.GLAURA_BILLING_ADMIN_UID?.trim();
  if (!webApiKey || !adminUid) return null;

  try {
    const customToken = await getAuth().createCustomToken(adminUid, { admin: true });
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(webApiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { idToken?: string };
    return data.idToken?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Requests a live Stripe Checkout payment link from api.glaura.ai (`POST /billing/stripe/admin-create-offer-link`)
 * when a Firebase providerId + billing admin auth are configured.
 */
export async function requestStripeOfferLink(input: {
  providerId: string;
  planCode: string;
  cadence: BillingCadence;
  lauraChannels: string | null;
  netMonthlyCents: number;
  freeMonths: number;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const token = await resolveBillingAdminToken();
  const base = (process.env.GLAURA_GATEWAY_URL?.trim() || "https://api.glaura.ai").replace(/\/+$/, "");
  const plan = GLAURA_PLANS.find((p) => p.code === input.planCode);
  if (!plan?.stripeV3Code) {
    return { ok: false, error: "Offre non mappée au catalogue Stripe V3." };
  }
  if (!token) {
    return {
      ok: false,
      error:
        "Authentification passerelle Stripe non configurée (FIREBASE_WEB_API_KEY + GLAURA_BILLING_ADMIN_UID ou GLAURA_BILLING_ADMIN_TOKEN) — devis enregistré en brouillon.",
    };
  }

  const billingCadence =
    input.cadence === "ANNUAL_1X" ? "annual_1x" : input.cadence === "ANNUAL_3X" ? "annual_3x" : "monthly";
  const hasLaura = Boolean(
    input.lauraChannels &&
      ["instagram", "whatsapp", "both", "phone", "full"].includes(input.lauraChannels) &&
      !plan.includesLauraBoth,
  );

  const body: Record<string, unknown> = {
    providerId: input.providerId,
    planCode: plan.stripeV3Code,
    billingCadence,
    laura: hasLaura,
    ...(hasLaura ? { lauraChannels: input.lauraChannels } : {}),
    ...(billingCadence === "monthly"
      ? { customMonthlyPriceCents: input.netMonthlyCents, duration: "forever" }
      : { freeMonths: input.freeMonths }),
  };

  try {
    const res = await fetch(`${base}/billing/stripe/admin-create-offer-link`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json()) as { url?: string; checkoutUrl?: string; message?: string; error?: string };
    if (!res.ok) {
      return { ok: false, error: data.message ?? data.error ?? `Erreur passerelle Stripe (${res.status}).` };
    }
    const url = data.url ?? data.checkoutUrl;
    if (!url) return { ok: false, error: "Aucun lien retourné par la passerelle." };
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erreur réseau passerelle Stripe." };
  }
}
