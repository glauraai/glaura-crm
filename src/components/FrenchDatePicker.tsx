"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"] as const;
const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
] as const;

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m: m - 1, d };
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.y, p.m, p.d + delta));
  return toYmd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

function formatFr(ymd: string): string {
  const p = parseYmd(ymd);
  if (!p) return "Choisir une date";
  return `${String(p.d).padStart(2, "0")}/${String(p.m + 1).padStart(2, "0")}/${p.y}`;
}

export function FrenchDatePicker({
  name,
  value,
  today,
  onChange,
  className = "",
}: {
  name: string;
  value: string;
  today: string;
  onChange: (nextYmd: string) => void;
  className?: string;
}) {
  const initial = parseYmd(value) ?? parseYmd(today) ?? { y: 2026, m: 10, d: 27 };
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initial.y);
  const [viewMonth, setViewMonth] = useState(initial.m);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const cells = useMemo(() => {
    const firstDow = (new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const list: Array<{ ymd: string | null; day: number | null }> = [];
    for (let i = 0; i < firstDow; i++) list.push({ ymd: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) list.push({ ymd: toYmd(viewYear, viewMonth, d), day: d });
    return list;
  }, [viewYear, viewMonth]);

  function openCalendar() {
    const p = parseYmd(value) ?? parseYmd(today);
    if (p) {
      setViewYear(p.y);
      setViewMonth(p.m);
    }
    setOpen((prev) => !prev);
  }

  function shiftMonth(delta: number) {
    const dt = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(dt.getUTCFullYear());
    setViewMonth(dt.getUTCMonth());
  }

  function pick(ymd: string) {
    onChange(ymd);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={openCalendar}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Choisir une date"
        className={`flex items-center justify-between gap-1.5 text-left ${className}`}
      >
        <span className="truncate">{formatFr(value)}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sélecteur de date"
          className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Mois précédent"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
            >
              ‹
            </button>
            <span className="text-xs font-semibold text-slate-900">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Mois suivant"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
            >
              ›
            </button>
          </div>

          <div className="mb-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => pick(today)}
              className="flex-1 rounded-md bg-slate-100 py-1 text-[11px] font-medium text-slate-700 hover:bg-rose-50 hover:text-rose-700"
            >
              Aujourd’hui
            </button>
            <button
              type="button"
              onClick={() => pick(addDaysYmd(today, 1))}
              className="flex-1 rounded-md bg-slate-100 py-1 text-[11px] font-medium text-slate-700 hover:bg-rose-50 hover:text-rose-700"
            >
              Demain
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-slate-400">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
            {cells.map((c, idx) =>
              c.ymd ? (
                <button
                  key={c.ymd}
                  type="button"
                  onClick={() => pick(c.ymd!)}
                  className={`flex h-7 w-full items-center justify-center rounded-md font-medium transition ${
                    c.ymd === value
                      ? "bg-rose-600 text-white"
                      : c.ymd === today
                        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                        : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {c.day}
                </button>
              ) : (
                <span key={`empty-${idx}`} />
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
