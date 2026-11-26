import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireMember } from "@/lib/access";
import { attachUnmatchedTranscript, reviewSuggestion, uploadTranscript } from "@/lib/agents/actions";
import { computeSuggestionDiff } from "@/lib/agents/echo";
import { OPPORTUNITY_STAGES } from "@/lib/pipeline/stages";
import { frenchDate } from "@/lib/crm-format";
import { SubmitButton } from "@/components/SubmitButton";
import { cn } from "@/lib/utils";

const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireMember();
  const admin = user.role === "ADMIN";
  const sp = await searchParams;
  const tab = sp.tab === "history" ? "history" : sp.tab === "transcripts" ? "transcripts" : "pending";

  const scope = admin ? {} : { OR: [{ assignedToId: user.id }, { salon: { assignedToId: user.id } }] };

  const [pendingCount, suggestions, unmatchedTranscripts, salons] = await Promise.all([
    prisma.agentSuggestion.count({ where: { ...scope, status: "PENDING" } }),
    prisma.agentSuggestion.findMany({
      where: {
        ...scope,
        status: tab === "history" ? { in: ["APPROVED", "MODIFIED", "REJECTED"] } : "PENDING",
      },
      include: {
        salon: { select: { id: true, name: true } },
        assignedTo: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    tab === "transcripts"
      ? prisma.transcriptRecord.findMany({
          where: { matchStatus: "UNMATCHED" },
          orderBy: { occurredAt: "desc" },
          take: 30,
        })
      : Promise.resolve([]),
    tab === "transcripts"
      ? prisma.salon.findMany({
          where: { archivedAt: null, ...(admin ? {} : { assignedToId: user.id }) },
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true },
          take: 150,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-rose-600">L’agent propose, le commercial valide</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Suggestions IA & Transcriptions ECHO</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rien n’est écrit dans le CRM sans validation humaine. {admin ? "Vue manager : accès complet aux validations et modifications de l’équipe." : "Validez, corrigez ou rejetez en un clic."}
          </p>
        </div>
        <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-800">
          {pendingCount} en attente
        </span>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {[
          ["pending", `À valider (${pendingCount})`],
          ["history", admin ? "Historique & diffs équipe" : "Historique de mes validations"],
          ["transcripts", "Transcriptions Allo / Upload ECHO"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/suggestions?tab=${key}`}
            className={cn("rounded-lg px-4 py-2 text-sm font-medium", tab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100")}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "transcripts" ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-950">Envoyer une transcription ou note vocale dictée à ECHO</h2>
            <p className="mt-1 text-xs text-slate-500">
              Les appels Allo arrivent automatiquement via <code className="rounded bg-slate-100 px-1 py-0.5">/api/webhooks/allo</code>. Utilisez ce formulaire pour une réunion Wispr Flow ou une note dictée après un RDV physique.
            </p>
            <form action={uploadTranscript} className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="text-sm md:col-span-2">
                Salon concerné
                <select name="salonId" required className={`${input} mt-1 w-full`}>
                  {salons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                Source
                <select name="source" defaultValue="WISPR_FLOW" className={`${input} mt-1 w-full`}>
                  <option value="WISPR_FLOW">Wispr Flow / Note vocale</option>
                  <option value="UPLOAD">Transcription manuelle</option>
                  <option value="ALLO">Appel Allo</option>
                </select>
              </label>
              <label className="text-sm">
                Durée (secondes, optionnel)
                <input name="durationSec" type="number" min={0} placeholder="ex. 240" className={`${input} mt-1 w-full`} />
              </label>
              <label className="text-sm md:col-span-3">
                Transcription ou résumé brut
                <textarea name="rawTranscript" required rows={5} placeholder="Collez la transcription ou vos notes dictées…" className={`${input} mt-1 w-full`} />
              </label>
              <div>
                <SubmitButton className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">
                  Analyser avec ECHO
                </SubmitButton>
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
            <h2 className="font-semibold text-slate-950">Appels Allo « à rattacher » ({unmatchedTranscripts.length})</h2>
            <p className="mt-1 text-xs text-slate-600">Numéros non reconnus automatiquement — rattachez au bon salon en un clic pour déclencher ECHO.</p>
            <div className="mt-4 space-y-3">
              {unmatchedTranscripts.map((t) => (
                <div key={t.id} className="rounded-lg border border-amber-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-900">{t.callerPhone ?? "Numéro masqué"} · {t.callDirection ?? "APPEL"}</span>
                    <span>{frenchDate(t.occurredAt, true)}{t.durationSec ? ` · ${t.durationSec}s` : ""}</span>
                  </div>
                  {t.summary && <p className="mt-2 text-sm text-slate-700">{t.summary}</p>}
                  <form action={attachUnmatchedTranscript} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="transcriptId" value={t.id} />
                    <select name="salonId" required className={`${input} min-w-60 flex-1`}>
                      {salons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <SubmitButton className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">Rattacher & lancer ECHO</SubmitButton>
                  </form>
                </div>
              ))}
              {unmatchedTranscripts.length === 0 && <p className="text-sm text-slate-500">Aucun appel en attente de rattachement.</p>}
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          {suggestions.map((s) => {
            const proposed = (s.proposedPayload ?? {}) as Record<string, unknown>;
            const applied = (s.appliedPayload ?? null) as Record<string, unknown> | null;
            const report = (s.generationReport ?? {}) as { actionsTaken?: string[]; assumptions?: string[]; toVerify?: string[]; sources?: string[] };
            const qual = (proposed.qualification ?? {}) as Record<string, unknown>;
            const diffs = s.status === "MODIFIED" ? computeSuggestionDiff(proposed, applied) : [];

            return (
              <article key={s.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">{s.agent}</span>
                      <span className="text-xs text-slate-500">{s.kind} · {frenchDate(s.createdAt, true)}</span>
                    </div>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">{s.title}</h2>
                    {s.salon && (
                      <Link href={`/salons/${s.salon.id}`} className="text-xs font-medium text-rose-700 hover:underline">
                        Ouvrir {s.salon.name} →
                      </Link>
                    )}
                  </div>
                  <span className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    s.status === "PENDING" ? "bg-amber-100 text-amber-800" : s.status === "REJECTED" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800",
                  )}>
                    {s.status === "PENDING" ? "En attente" : s.status === "APPROVED" ? "Validée" : s.status === "MODIFIED" ? "Modifiée & validée" : "Rejetée"}
                  </span>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1.5">
                    <p className="font-semibold text-slate-800">Proposition structurée</p>
                    <p><strong>Conversation décideur :</strong> {proposed.isDecisionMakerCall ? "Oui" : "Non"}</p>
                    {Boolean(proposed.proposedStage) && <p><strong>Stade proposé :</strong> {String(proposed.proposedStage)}</p>}
                    {Boolean(proposed.nextStep) && <p><strong>Prochaine étape :</strong> {String(proposed.nextStep)} {proposed.nextStepDate ? `(${String(proposed.nextStepDate)})` : ""}</p>}
                    {Boolean(qual.currentTool) && <p><strong>Outil actuel :</strong> {String(qual.currentTool)}</p>}
                    {Boolean(qual.mainPain) && <p><strong>Besoin :</strong> {String(qual.mainPain)}</p>}
                    {Boolean(qual.salesAngle) && <p><strong>Angle :</strong> {String(qual.salesAngle)}</p>}
                  </div>

                  <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-1.5">
                    <p className="font-semibold text-slate-800">Rapport de génération</p>
                    {report.actionsTaken?.length ? <p><strong>Fait :</strong> {report.actionsTaken.join(" · ")}</p> : null}
                    {report.assumptions?.length ? <p><strong>Hypothèses :</strong> {report.assumptions.join(" · ")}</p> : null}
                    {report.toVerify?.length ? <p className="text-amber-800"><strong>À vérifier :</strong> {report.toVerify.join(" · ")}</p> : null}
                    {report.sources?.length ? <p className="text-slate-500"><strong>Sources :</strong> {report.sources.join(", ")}</p> : null}
                  </div>
                </div>

                {diffs.length > 0 && (
                  <div className="mt-3 rounded-lg bg-sky-50 p-3 text-xs">
                    <p className="font-semibold text-sky-900">Modifications apportées par {s.reviewedBy?.name ?? s.reviewedBy?.email}</p>
                    <ul className="mt-1 space-y-0.5 text-sky-800">
                      {diffs.map((d) => (
                        <li key={d.field}>
                          <code>{d.field}</code> : <span className="line-through">{JSON.stringify(d.before)}</span> → <strong>{JSON.stringify(d.after)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {s.status === "PENDING" && (
                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                    <form action={reviewSuggestion} className="flex flex-wrap items-end gap-2 flex-1">
                      <input type="hidden" name="suggestionId" value={s.id} />
                      <input type="hidden" name="returnTo" value="/suggestions" />
                      <label className="text-xs text-slate-600">
                        Stade
                        <select name="proposedStage" defaultValue={String(proposed.proposedStage ?? "")} className={`${input} mt-1 block h-9 text-xs`}>
                          <option value="">Inchangé</option>
                          {OPPORTUNITY_STAGES.map((st) => <option key={st.stage} value={st.stage}>{st.label}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600 flex-1 min-w-44">
                        Prochaine étape
                        <input name="nextStep" defaultValue={String(proposed.nextStep ?? "")} className={`${input} mt-1 block h-9 w-full text-xs`} />
                      </label>
                      <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-700">
                        <input type="checkbox" name="isDecisionMakerCall" defaultChecked={Boolean(proposed.isDecisionMakerCall)} />
                        Décideur
                      </label>
                      <SubmitButton name="decision" value="APPROVED" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
                        Valider en 1 clic
                      </SubmitButton>
                      <SubmitButton name="decision" value="MODIFIED" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                        Modifier & valider
                      </SubmitButton>
                      <SubmitButton name="decision" value="REJECTED" className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                        Rejeter
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </article>
            );
          })}
          {suggestions.length === 0 && (
            <p className="rounded-xl border border-dashed p-12 text-center text-sm text-slate-500">
              Aucune suggestion dans cette vue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
