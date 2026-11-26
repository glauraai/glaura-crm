import { requireMember } from "@/lib/access";
import { CopyLinkButton } from "@/components/CopyLinkButton";

// Public Glaura pages the sales team opens in a demo or sends to a salon.
const LINKS = [
  { url: "https://glaura.ai", title: "Glaura", description: "Le site grand public : trouver un salon et réserver en ligne." },
  { url: "https://glaura.ai/pro", title: "Glaura Pro", description: "La page pour les salons : agenda, réservation en ligne, caisse et paiements." },
  { url: "https://glaura.ai/laura", title: "Laura", description: "L’assistante IA qui répond aux messages Instagram et WhatsApp et prend les rendez-vous." },
] as const;

export default async function LiensUtilesPage() {
  await requireMember();
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-sm font-medium text-rose-600">Ressources</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Liens utiles</h1>
        <p className="mt-2 text-sm text-slate-500">Les pages Glaura à montrer en rendez-vous ou à envoyer aux salons.</p>
      </header>
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
