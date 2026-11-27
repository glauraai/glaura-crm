"use client";

import { useState } from "react";

const QUICK_QUESTIONS = [
  "Comment répondre à une gérante qui trouve Planity suffisant ?",
  "Que dire si elle dit qu’elle n’a pas besoin de nouvelles clientes ?",
  "Comment présenter Laura IA face à une réticence à l’IA ?",
  "Comment expliquer la commission Glaura vs Planity/Treatwell ?",
];

export function PlaybookQaPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 4) return;
    setLoading(true);
    setError(null);
    setQuestion(trimmed);
    try {
      const res = await fetch("/api/playbook/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Erreur lors de la réponse MENTOR.");
      } else {
        setAnswer(data.answer ?? "");
      }
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="border-b border-slate-200 bg-slate-50 px-4 py-4 md:px-8">
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">MENTOR · Mode Question</p>
            <h2 className="text-sm font-semibold text-slate-900">Poser une question au Playbook & aux objections terrain</h2>
          </div>
          <span className="text-xs text-slate-500">Basé sur le Playbook Glaura + stats CRM (Haiku 5.5)</span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ex. Comment répondre à un salon qui utilise déjà Planity et Treatwell ?"
            className="min-w-64 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <button
            type="submit"
            disabled={loading || question.trim().length < 4}
            className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {loading ? "MENTOR réfléchit…" : "Demander à MENTOR"}
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void ask(q)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-violet-300 hover:text-violet-800"
            >
              {q}
            </button>
          ))}
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        {answer && (
          <div className="rounded-xl border border-violet-200 bg-white p-4 text-sm whitespace-pre-wrap text-slate-800 shadow-xs">
            {answer}
          </div>
        )}
      </div>
    </section>
  );
}
