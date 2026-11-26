import { requireMember } from "@/lib/access";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { SubmitButton } from "@/components/SubmitButton";
import { prisma } from "@/lib/db";
import { setMyBookingUrl } from "@/lib/team-actions";

// Public Glaura pages the sales team opens in a demo or sends to a salon.
const LINKS = [
  { url: "https://glaura.ai", title: "Glaura", description: "Le site grand public : trouver un salon et réserver en ligne." },
  { url: "https://glaura.ai/pro", title: "Glaura Pro", description: "La page pour les salons : agenda, réservation en ligne, caisse et paiements." },
  { url: "https://glaura.ai/laura", title: "Laura", description: "L’assistante IA qui répond aux messages Instagram et WhatsApp et prend les rendez-vous." },
] as const;

const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";

export default async function LiensUtilesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireMember();
  const { error } = await searchParams;
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { bookingUrl: true } });
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-sm font-medium text-rose-600">Ressources</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Liens utiles</h1>
        <p className="mt-2 text-sm text-slate-500">Les pages Glaura à montrer en rendez-vous ou à envoyer aux salons.</p>
      </header>
      <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-5">
        <h2 className="font-semibold text-slate-950">Mon lien de rendez-vous</h2>
        <p className="mt-1 text-sm text-slate-600">
          Votre page de prise de rendez-vous Google Agenda. Envoyez-la aux salons pour qu’ils réservent une démo avec vous ;
          elle est aussi utilisée par les liens « démo » des séquences Instagram.
        </p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-rose-100 p-3 text-sm text-rose-800">{error}</p>}
        {me?.bookingUrl && <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-2 break-all text-sm font-medium text-rose-700">{me.bookingUrl.replace("https://", "")}</span>
          <a href={me.bookingUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">Ouvrir ↗</a>
          <CopyLinkButton url={me.bookingUrl} />
        </div>}
        <form action={setMyBookingUrl} className="mt-4 flex flex-wrap gap-2">
          <input name="bookingUrl" type="url" defaultValue={me?.bookingUrl ?? ""} placeholder="https://calendar.app.google/…" aria-label="Mon lien de rendez-vous" className={`${input} min-w-72 flex-1`} />
          <SubmitButton className={input}>{me?.bookingUrl ? "Mettre à jour" : "Enregistrer"}</SubmitButton>
        </form>
        <details className="mt-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">Comment obtenir mon lien ?</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Ouvrez Google Agenda avec votre compte Glaura.</li>
            <li>Cliquez sur « Créer » puis « Agenda de rendez-vous » et choisissez vos créneaux de démo.</li>
            <li>Ouvrez l’agenda créé, cliquez sur « Partager » et copiez le lien de la page de réservation.</li>
            <li>Collez-le ici. Laissez le champ vide pour revenir au lien par défaut.</li>
          </ol>
        </details>
      </section>
      <ul className="grid gap-4 md:grid-cols-3">
        {LINKS.map(link => (
          <li key={link.url} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-950">{link.title}</h2>
            <p className="mt-1 text-sm text-rose-700">{link.url.replace("https://", "")}</p>
            <p className="mt-3 flex-1 text-sm text-slate-600">{link.description}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={link.url} target="_blank" rel="noreferrer" className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">Ouvrir ↗</a>
              <CopyLinkButton url={link.url} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
