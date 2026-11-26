"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IMPORT_BATCH_SIZE, LEAD_FIELDS, LEAD_FIELD_LABEL, MAX_IMPORT_ROWS,
  buildLeads, decodeCsvBytes, detectMapping, parseCsv,
  type ColumnMapping, type LeadField, type ParsedCsv,
} from "@/lib/prospection/csv-import";
import { importLeadBatch } from "@/lib/prospection/import-actions";

const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";
const button = "rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50";

type Owner = { id: string; name: string | null; email: string | null };
// Semicolons + BOM: French Excel opens this with accents and columns intact.
const TEMPLATE_CSV = "﻿" + [
  "Nom du salon;Adresse;Code postal;Ville;Téléphone;E-mail;Instagram;Site web;Lien Planity / Treatwell;Contact;Métier;Notes",
  "Salon Exemple;12 rue Oberkampf;75011;Paris;06 12 34 56 78;contact@salon-exemple.fr;@salonexemple;https://salon-exemple.fr;;Léa;Ongles;Rappeler lundi",
].join("\r\n");

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "modele-import-leads.csv" });
  link.click();
  URL.revokeObjectURL(url);
}

type Totals ={ created: number; skipped: number; alreadyInCrm: number; failedBatches: number };

export function LeadImporter({ admin, users }: { admin: boolean; users: Owner[] }) {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; parsed: ParsedCsv } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [ownerId, setOwnerId] = useState("me");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const leads = useMemo(() => (file ? buildLeads(file.parsed, mapping) : []), [file, mapping]);
  const busy = progress !== null && progress.done < progress.total;

  async function onFile(selected: File | undefined) {
    setTotals(null); setReadError(null); setFile(null);
    if (!selected) return;
    try {
      const parsed = parseCsv(decodeCsvBytes(new Uint8Array(await selected.arrayBuffer())));
      if (!parsed.rows.length) { setReadError("Ce fichier ne contient aucune ligne de données."); return; }
      setFile({ name: selected.name, parsed });
      setMapping(detectMapping(parsed));
    } catch {
      setReadError("Impossible de lire ce fichier. Exportez-le au format CSV depuis Excel ou Google Sheets.");
    }
  }

  function setColumn(col: number, field: LeadField | null) {
    // Each field belongs to one column: picking it elsewhere frees the old one.
    setMapping(current => current.map((f, i) => (i === col ? field : field && f === field ? null : f)));
  }

  async function runImport() {
    const batches = Array.from({ length: Math.ceil(leads.length / IMPORT_BATCH_SIZE) }, (_, i) => leads.slice(i * IMPORT_BATCH_SIZE, (i + 1) * IMPORT_BATCH_SIZE));
    let acc: Totals = { created: 0, skipped: 0, alreadyInCrm: 0, failedBatches: 0 };
    setTotals(null);
    setProgress({ done: 0, total: leads.length });
    for (const [i, batch] of batches.entries()) {
      // One retry per batch; a failed batch never stops the remaining ones.
      let result = await importLeadBatch({ leads: batch, ownerId: admin ? ownerId : null }).catch(() => null);
      if (!result?.ok) result = await importLeadBatch({ leads: batch, ownerId: admin ? ownerId : null }).catch(() => null);
      acc = result?.ok
        ? { ...acc, created: acc.created + result.created, skipped: acc.skipped + result.skipped, alreadyInCrm: acc.alreadyInCrm + result.alreadyInCrm }
        : { ...acc, failedBatches: acc.failedBatches + 1 };
      if (result && !result.ok && i === 0) setReadError(result.error);
      setProgress({ done: Math.min((i + 1) * IMPORT_BATCH_SIZE, leads.length), total: leads.length });
    }
    setTotals(acc);
    setFile(null);
    router.refresh();
  }

  const sample = (col: number) => file?.parsed.rows.find(r => r[col]?.trim())?.[col] ?? "";

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-5" open={Boolean(file || totals)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span><span className="block font-semibold text-slate-950">Importer mes leads</span><span className="text-sm text-slate-500">Ajoutez vos propres salons depuis un fichier CSV</span></span>
        <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700">Importer un fichier</span>
      </summary>
      <p className="mt-2 text-sm text-slate-500">
        Exportez votre fichier en CSV depuis Excel, Google Sheets ou Airtable. Les colonnes sont reconnues automatiquement ;
        vous pouvez corriger la correspondance avant l’import. Les colonnes non reconnues sont conservées dans les notes.
      </p>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) onFile(e.dataTransfer.files?.[0]); }}
        className={`mt-4 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-rose-400 bg-rose-50" : "border-slate-200 bg-slate-50"}`}
      >
        {/* The native input is hidden: its label ("Choose File…") follows the browser language. */}
        <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" disabled={busy} className="sr-only" tabIndex={-1}
          aria-label="Fichier CSV de leads" onChange={e => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-rose-600" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
        <p className="text-sm text-slate-700">
          {file ? <><strong>{file.name}</strong> est prêt à être importé.</> : "Glissez votre fichier CSV ici, ou"}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={button}>
            {file ? "Choisir un autre fichier" : "Télécharger mon fichier CSV"}
          </button>
          <button type="button" onClick={downloadTemplate} className={input}>Télécharger le modèle CSV</button>
        </div>
        <p className="text-xs text-slate-500">Formats acceptés : .csv, .tsv, .txt · jusqu’à {MAX_IMPORT_ROWS.toLocaleString("fr-FR")} lignes</p>
      </div>
      {readError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{readError}</p>}

      {file && <div className="mt-5 space-y-5">
        <p className="text-sm text-slate-700">
          <strong>{file.name}</strong> · {file.parsed.rows.length.toLocaleString("fr-FR")} ligne(s)
          {!file.parsed.hasHeader && " · pas de ligne d’en-tête détectée"}
          {file.parsed.rows.length > MAX_IMPORT_ROWS && ` · seules les ${MAX_IMPORT_ROWS.toLocaleString("fr-FR")} premières seront importées`}
        </p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-4">Colonne du fichier</th><th className="py-2 pr-4">Exemple</th><th className="py-2">Champ Glaura</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{file.parsed.headers.map((header, col) => <tr key={col}>
            <td className="py-2 pr-4 font-medium text-slate-900">{header}</td>
            <td className="max-w-64 truncate py-2 pr-4 text-slate-500" title={sample(col)}>{sample(col) || "—"}</td>
            <td className="py-2"><select aria-label={`Champ pour ${header}`} value={mapping[col] ?? ""} onChange={e => setColumn(col, (e.target.value || null) as LeadField | null)} className={input}>
              <option value="">Garder dans les notes</option>
              {LEAD_FIELDS.map(f => <option key={f} value={f}>{LEAD_FIELD_LABEL[f]}</option>)}
            </select></td>
          </tr>)}</tbody></table></div>
        {!mapping.includes("name") && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Aucune colonne « Nom du salon » : le contact, l’Instagram, l’e-mail ou le téléphone servira de nom.</p>}
        <div><h3 className="text-sm font-semibold text-slate-900">Aperçu</h3><div className="mt-2 overflow-x-auto rounded-lg border border-slate-100"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Salon", "Adresse", "Téléphone", "E-mail", "Instagram", "Contact"].map(t => <th key={t} className="px-3 py-2 font-medium">{t}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{leads.slice(0, 5).map((l, i) => <tr key={i}><td className="px-3 py-2 font-medium text-slate-900">{l.name}</td><td className="px-3 py-2">{[l.address, l.postalCode, l.city].filter(Boolean).join(" · ") || "—"}</td><td className="px-3 py-2">{l.phone ?? "—"}</td><td className="px-3 py-2">{l.email ?? "—"}</td><td className="px-3 py-2">{l.instagram ? `@${l.instagram}` : "—"}</td><td className="px-3 py-2">{l.contactName ?? "—"}</td></tr>)}</tbody></table></div></div>
        <div className="flex flex-wrap items-end gap-3">
          {admin && <label className="text-sm text-slate-600">Attribuer à<select value={ownerId} onChange={e => setOwnerId(e.target.value)} className={`${input} ml-2`}><option value="me">Moi</option><option value="">Non attribués</option>{users.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}</select></label>}
          <button type="button" onClick={runImport} disabled={busy || !leads.length} className={button}>
            {busy ? `Import en cours… ${progress?.done}/${progress?.total}` : `Importer ${leads.length.toLocaleString("fr-FR")} lead(s)`}
          </button>
          <button type="button" onClick={() => setFile(null)} disabled={busy} className={input}>Annuler</button>
        </div>
      </div>}

      {totals && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        {totals.created.toLocaleString("fr-FR")} lead(s) importé(s)
        {totals.skipped > 0 && ` · ${totals.skipped.toLocaleString("fr-FR")} déjà présent(s), ignoré(s)`}
        {totals.alreadyInCrm > 0 && ` · ${totals.alreadyInCrm.toLocaleString("fr-FR")} déjà dans les salons du CRM`}
        {totals.failedBatches > 0 && ` · ${totals.failedBatches} lot(s) non importé(s) : relancez le même fichier, rien ne sera dupliqué.`}
      </p>}
    </details>
  );
}
