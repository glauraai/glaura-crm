import { requireMember } from "@/lib/access";

export default async function PlaybookPage() {
  await requireMember();
  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-8">
        <h1 className="text-lg font-semibold text-slate-950">Playbook commercial</h1>
        <a href="/playbook-files/index.html" target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Ouvrir en plein écran ↗</a>
      </div>
      <iframe src="/playbook-files/index.html" title="Playbook commercial" className="w-full flex-1 border-0" />
    </div>
  );
}
