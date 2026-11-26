import Link from "next/link";
import { prisma } from "@/lib/db";
import { calendarConfigured, getBusySlots } from "@/lib/google-calendar";
import { dayLabel, parisDay, parisTime, workingDays } from "@/lib/availability";
import { AvailabilityRows } from "@/components/AvailabilityRows";
import { cn } from "@/lib/utils";

const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
const DAYS = 5;

// Google Calendar busy slots (no event details). A rep sees their own week; an
// admin sees the whole team for one day, or one rep's week when filtering on them.
export async function AvailabilityPanel({ person, team, day, hrefForDay }: {
  person?: { email: string; label: string };
  team?: boolean;
  day?: string;
  hrefForDay: (day: string) => string;
}) {
  if (!calendarConfigured()) return null;
  const now = new Date();
  const today = parisDay(now);
  const days = workingDays(now, DAYS);

  if (team) {
    const selected = day && days.includes(day) ? day : days[0];
    const members = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { email: true, name: true } });
    const busy = await getBusySlots(members.map(m => m.email), parisTime(selected, 0), parisTime(selected, 24));
    return (
      <section className={cn(card, "mb-6")}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Disponibilités de l’équipe</h2>
            <p className="text-xs text-slate-500">D’après Google Agenda : créneaux occupés uniquement, sans le détail des rendez-vous.</p>
          </div>
          <nav aria-label="Jour affiché" className="flex flex-wrap gap-1.5">
            {days.map(d => <Link key={d} href={hrefForDay(d)} aria-current={d === selected ? "date" : undefined}
              className={cn("rounded-full px-3 py-1 text-xs font-medium", d === selected ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>{dayLabel(d, today)}</Link>)}
          </nav>
        </div>
        <AvailabilityRows rows={members.map(m => ({ key: m.email, label: m.name ?? m.email, day: selected, result: busy.get(m.email.toLowerCase()) }))} />
      </section>
    );
  }

  if (!person) return null;
  const busy = await getBusySlots([person.email], parisTime(days[0], 0), parisTime(days[days.length - 1], 24));
  const result = busy.get(person.email.toLowerCase());
  return (
    <section className={cn(card, "mb-6")}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-950">{person.label}</h2>
        <p className="text-xs text-slate-500">D’après Google Agenda : créneaux occupés de 8h à 20h, sans le détail des rendez-vous.</p>
      </div>
      <AvailabilityRows rows={days.map(d => ({ key: d, label: dayLabel(d, today), day: d, result }))} />
    </section>
  );
}
