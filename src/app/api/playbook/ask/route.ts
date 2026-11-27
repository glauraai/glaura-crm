import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { checkUserAiBudget, runCachedHaikuText } from "@/lib/agents/llm";
import { computeObjectionStats, KNOWN_OBJECTIONS, MENTOR_RUBRIC_STEPS } from "@/lib/agents/mentor";
import { SALES_ANGLES } from "@/lib/gtm/scoring";
import { GLAURA_PLANS, LAURA_OPTIONS, SYNC_OPTION_CENTS, formatEurCents } from "@/lib/pricing/catalog";

const askSchema = z.object({
  question: z.string().trim().min(4).max(600),
});

const PLAYBOOK_SYSTEM_PROMPT = `Tu es MENTOR, l'assistant Playbook commercial intégré au CRM Glaura.
Tu réponds de façon directe, actionnable et concise (en français, en tutoyant le commercial) aux questions terrain.
Base-toi UNIQUEMENT sur le référentiel Glaura ci-dessous et les statistiques réelles d'objections fournies :

1) Les 6 angles de vente Glaura :
${SALES_ANGLES.map((a, i) => `${i + 1}. ${a}`).join("\n")}

2) Les 8 étapes d'un rendez-vous réussi :
${MENTOR_RUBRIC_STEPS.map((s) => `${s.step}. ${s.label}`).join("\n")}

3) Les objections connues et réponses de référence :
${KNOWN_OBJECTIONS.map((o) => `- ${o.label} → ${o.referenceResponse}`).join("\n")}

4) Grille tarifaire V3 HT/mois :
${GLAURA_PLANS.map((p) => `- ${p.name} : ${formatEurCents(p.monthlyHtCents)}/mois (${p.targetSegment})${p.freeWebsiteOnAnnual ? " — site personnalisé 500 € offert en annuel" : ""}`).join("\n")}
- Options Laura IA : ${LAURA_OPTIONS.filter((o) => o.monthlyHtCents > 0).map((o) => `${o.label} (${formatEurCents(o.monthlyHtCents)})`).join(", ")}
- Synchronisation Planity / Treatwell : ${formatEurCents(SYNC_OPTION_CENTS)}/mois
- Annuel : ×10 en 1 fois (2 mois offerts), ×11 en 3 fois (1 mois offert).
- Commission Glaura : 0 % sur la clientèle du salon, 10 % une seule fois sur une nouvelle cliente apportée par l'app Glaura.

Format de réponse :
- Une réponse verbatim prête à dire au gérant (2-3 phrases max)
- Le point d'attention / pivot playbook
- Si une stat CRM terrain est pertinente, cite-la.`;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête JSON invalide." }, { status: 400 });
  }

  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Pose une question d’au moins 4 caractères." }, { status: 400 });
  }

  const recentObjections = await prisma.objectionRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { category: true, responseGiven: true, succeeded: true },
  });
  const stats = computeObjectionStats(recentObjections).slice(0, 6);

  // Fallback offline response if ANTHROPIC_API_KEY is missing or monthly cap reached
  const budget = await checkUserAiBudget(session.user.id);
  if (!budget.allowed) {
    return NextResponse.json({ error: budget.reason ?? "Plafond IA mensuel atteint." }, { status: 429 });
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    const q = parsed.data.question.toLowerCase();
    const matched = KNOWN_OBJECTIONS.find(
      (o) =>
        (q.includes("planity") && o.category.includes("PLANITY")) ||
        (q.includes("commission") && o.category === "COMMISSION") ||
        (q.includes("ia") && o.category === "RETICENCE_IA") ||
        (q.includes("client") && o.category === "PAS_BESOIN_NOUVEAUX_CLIENTS"),
    );
    const answer = matched
      ? `Réponse de référence (${matched.label}) :\n${matched.referenceResponse}`
      : "Utilise le déroulé Glaura en 8 étapes : valide d’abord le besoin prioritaire, montre la solution sur le compte démo préparé, puis relie le prix au besoin (avec le site personnalisé offert en annuel).";
    return NextResponse.json({ answer, source: "playbook_static" });
  }

  try {
    const { text, usage } = await runCachedHaikuText({
      systemPrompt: PLAYBOOK_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        question: parsed.data.question,
        liveCrmObjectionStats: stats,
      }),
      maxTokens: 600,
    });
    return NextResponse.json({ answer: text, usage, source: "mentor_haiku" });
  } catch (err) {
    console.error("[MENTOR Playbook Q&A] error:", err);
    return NextResponse.json({ error: "Impossible de joindre MENTOR pour le moment." }, { status: 502 });
  }
}
