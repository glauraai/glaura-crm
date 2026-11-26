import { DAY_END_HOUR, DAY_START_HOUR, dayBlocks } from "@/lib/availability";
import type { BusyResult } from "@/lib/google-calendar";

export type AvailabilityRow = { key: string; label: string; day: string; result: BusyResult | undefined };

const HOURS = Array.from({ length: (DAY_END_HOUR - DAY_START_HOUR) / 2 + 1 }, (_, i) => DAY_START_HOUR + i * 2);

/** One 8h–20h track per row; busy blocks in rose, free time left empty. */
export function AvailabilityRows({ rows }: { rows: AvailabilityRow[] }) {
  return (
    <div className="space-y-2">
      <div className="ml-36 hidden justify-between text-[11px] text-slate-400 sm:flex">
        {HOURS.map(h => <span key={h}>{h}h</span>)}
      </div>
      {rows.map(row => {
        const blocks = row.result && "busy" in row.result ? dayBlocks(row.result.busy, row.day) : [];
        const unavailable = !row.result || "error" in row.result;
        return (
          <div key={row.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <p className="w-33 shrink-0 truncate text-sm font-medium text-slate-700" title={row.label}>{row.label}</p>
            <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-emerald-50 ring-1 ring-slate-200"
              aria-label={unavailable ? `${row.label} : agenda indisponible` : blocks.length ? `${row.label} : occupé ${blocks.map(b => b.label).join(", ")}` : `${row.label} : libre`}>
              {HOURS.slice(1, -1).map(h => <span key={h} aria-hidden className="absolute inset-y-0 w-px bg-slate-200" style={{ left: `${((h - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }} />)}
              {unavailable
                ? <span className="absolute inset-0 flex items-center justify-center bg-slate-100 text-xs text-slate-500">Agenda indisponible</span>
                : blocks.length === 0
                  ? <span className="absolute inset-0 flex items-center justify-center text-xs text-emerald-700">Libre</span>
                  : blocks.map(b => <span key={b.label} title={`Occupé ${b.label}`} className="absolute inset-y-1 rounded bg-rose-500/85" style={{ left: `${b.left}%`, width: `${Math.max(b.width, 0.8)}%` }} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
