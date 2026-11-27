import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  calendarConfigured,
  getBusySlots,
  getCalendarEvents,
  type BusyResult,
  type EventsResult,
} from "@/lib/google-calendar";
import { dayLabel, parisDay, parisTime, timeLabel, workingDays } from "@/lib/availability";
import {
  mergeCalendarAndCrmMeetings,
  type DashboardMeeting,
  type MatchableSalon,
} from "@/lib/calendar-sync";
import { ACTIVITY_LABEL, STATUS_LABEL, STATUS_STYLE } from "@/lib/labels";
import { AvailabilityRows } from "@/components/AvailabilityRows";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/generated/prisma/enums";

const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
const DAYS = 5;

function toBusyFromEvents(res: EventsResult | undefined): BusyResult | undefined {
  if (!res) return undefined;
  if ("error" in res) return res;
  return {
    busy: res.events
      .filter((e) => !e.allDay)
      .map((e) => ({ start: e.start, end: e.end })),
  };
}

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// 2-way Agenda & Meetings panel for every role:
// - Shows full meeting cards for the selected day (Google Agenda + CRM scheduled VISITE/VISIO/activities),
//   auto-matched to CRM salons with contact phone, address, status, Meet link, attendees & notes.
// - Preserves the 8h-20h availability timeline (gracefully falling back to free/busy if calendar.events
//   scope isn't enabled yet in Google Workspace Admin).
export async function AvailabilityPanel({
  viewerEmail,
  viewerIsAdmin,
  person,
  team,
  day,
  ownerFilter,
  periodFilter,
  hrefForDay,
}: {
  viewerEmail?: string | null;
  viewerIsAdmin?: boolean;
  person?: { id?: string; email: string; label: string };
  team?: boolean;
  day?: string;
  ownerFilter?: string;
  periodFilter?: string;
  hrefForDay: (day: string) => string;
}) {
  const now = new Date();
  const today = parisDay(now);
  const days = workingDays(now, DAYS);
  const selectedDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
  const dayStart = parisTime(selectedDay, 0);
  const dayEnd = parisTime(selectedDay, 24);
  const calConfigured = calendarConfigured();

  const members = team
    ? await prisma.user.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, email: true, name: true },
      })
    : person
      ? [{ id: person.id ?? "", email: person.email, name: person.label }]
      : [];

  const memberEmails = members.map((m) => m.email).filter(Boolean);
  const memberIds = members.map((m) => m.id).filter(Boolean);

  // Query CRM scheduled activities for the selected day + matchable salons for auto-linking Google events
  const [crmActivitiesRaw, matchableSalonsRaw] = await Promise.all([
    prisma.activity.findMany({
      where: {
        scheduledAt: { gte: dayStart, lt: dayEnd },
        salon: { archivedAt: null },
        ...(team ? {} : memberIds.length ? { OR: [{ userId: { in: memberIds } }, { salon: { assignedToId: { in: memberIds } } }] } : {}),
      },
      include: {
        user: { select: { email: true, name: true } },
        salon: {
          select: {
            id: true,
            name: true,
            status: true,
            contactName: true,
            contactEmail: true,
            phone: true,
            address: true,
            instagram: true,
            notes: true,
            bookingTool: true,
            contacts: { select: { email: true, name: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.salon.findMany({
      where: {
        archivedAt: null,
        ...(team ? {} : memberIds.length ? { assignedToId: { in: memberIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        contactName: true,
        contactEmail: true,
        phone: true,
        address: true,
        instagram: true,
        notes: true,
        bookingTool: true,
        contacts: { select: { email: true, name: true } },
      },
      take: 1500,
    }),
  ]);

  const salons: MatchableSalon[] = matchableSalonsRaw;

  let eventsMap = new Map<string, EventsResult>();
  let busyMap = new Map<string, BusyResult>();
  let needsEventsScope = false;

  if (calConfigured && memberEmails.length > 0) {
    const timelineStart = team ? dayStart : parisTime(days[0], 0);
    const timelineEnd = team ? dayEnd : parisTime(days[days.length - 1], 24);
    const fetchStart = timelineStart < dayStart ? timelineStart : dayStart;
    const fetchEnd = timelineEnd > dayEnd ? timelineEnd : dayEnd;

    eventsMap = await getCalendarEvents(memberEmails, fetchStart, fetchEnd);
    needsEventsScope = [...eventsMap.values()].some((r) => "error" in r && r.error === "events_scope_required");

    if (needsEventsScope) {
      busyMap = await getBusySlots(memberEmails, timelineStart, timelineEnd);
    } else {
      for (const [email, res] of eventsMap) {
        const b = toBusyFromEvents(res);
        if (b) busyMap.set(email, b);
      }
    }
  }

  const viewerLower = viewerEmail?.trim().toLowerCase() ?? "";
  const calendarEntries = members.map((m) => {
    const key = m.email.trim().toLowerCase();
    const res = eventsMap.get(key);
    const allEvents = res && "events" in res ? res.events : [];
    const dayEvents = allEvents.filter((e) => e.end > dayStart && e.start < dayEnd);
    const isSelf = key === viewerLower;
    return {
      ownerEmail: m.email,
      ownerName: m.name ?? m.email,
      maskPrivate: !isSelf,
      events: dayEvents,
    };
  });

  const meetings: DashboardMeeting[] = mergeCalendarAndCrmMeetings({
    calendarEntries,
    crmActivities: crmActivitiesRaw
      .filter((a): a is typeof a & { scheduledAt: Date } => Boolean(a.scheduledAt))
      .map((a) => ({
        id: a.id,
        type: a.type,
        scheduledAt: a.scheduledAt,
        durationMin: a.durationMin,
        notes: a.notes,
        calendarEventId: a.calendarEventId,
        calendarEventUrl: a.calendarEventUrl,
        meetUrl: a.meetUrl,
        salon: a.salon,
        ownerEmail: a.user?.email ?? "",
        ownerName: a.user?.name ?? a.user?.email ?? "Équipe",
      })),
    salons,
  });

  const title = team ? "Agenda & rendez-vous de l’équipe" : person?.label ? `Agenda & rendez-vous — ${person.label}` : "Mon agenda & rendez-vous";
  const selectedLabel = dayLabel(selectedDay, today);

  return (
    <section className={cn(card, "mb-6 space-y-5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
              {meetings.length} RDV · {selectedLabel}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {calConfigured && !needsEventsScope
              ? "Synchronisation bidirectionnelle Google Agenda + RDV CRM avec fiches salons et liens Google Meet."
              : calConfigured && needsEventsScope
                ? "Créneaux Google Agenda (libre/occupé) + RDV planifiés dans le CRM."
                : "RDV planifiés dans le CRM (connectez Google Agenda via GOOGLE_CALENDAR_SA_KEY pour la synchro bidirectionnelle)."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Jour affiché" className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <Link
                key={d}
                href={hrefForDay(d)}
                aria-current={d === selectedDay ? "date" : undefined}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  d === selectedDay
                    ? "bg-slate-950 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
                )}
              >
                {dayLabel(d, today)}
              </Link>
            ))}
          </nav>

          <form method="GET" action="/dashboard" className="flex items-center gap-1.5">
            {ownerFilter && <input type="hidden" name="owner" value={ownerFilter} />}
            {periodFilter && <input type="hidden" name="period" value={periodFilter} />}
            <input
              type="date"
              name="dispo"
              defaultValue={selectedDay}
              aria-label="Choisir une date"
              className="h-7 rounded-full border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
            />
            <button
              type="submit"
              className="h-7 rounded-full bg-slate-100 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              Voir
            </button>
          </form>
        </div>
      </div>

      {needsEventsScope && viewerIsAdmin && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          <strong>Synchro 2-way Google Agenda :</strong> ajoutez le scope{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">https://www.googleapis.com/auth/calendar.events</code>{" "}
          au compte de service <code className="rounded bg-amber-100 px-1 py-0.5">glaura-crm-calendar</code> dans Google Workspace Admin pour lire les détails des RDV et créer les événements Visite/Visio automatiquement.
        </p>
      )}

      {/* Visual 8h-20h availability timeline */}
      {calConfigured && members.length > 0 && (
        <div>
          {team ? (
            <AvailabilityRows
              rows={members.map((m) => ({
                key: m.email,
                label: m.name ?? m.email,
                day: selectedDay,
                result: busyMap.get(m.email.trim().toLowerCase()),
              }))}
            />
          ) : (
            <AvailabilityRows
              rows={days.map((d) => ({
                key: d,
                label: dayLabel(d, today),
                day: d,
                result: busyMap.get(members[0].email.trim().toLowerCase()),
              }))}
            />
          )}
        </div>
      )}

      {/* Detailed meeting cards for the selected day */}
      <div className="border-t border-slate-100 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Rendez-vous — {selectedLabel} ({meetings.length})
          </h3>
          <span className="text-xs text-slate-400">
            Créez une Visite ou Visio depuis une fiche salon pour l’ajouter ici et sur Google Agenda.
          </span>
        </div>

        {meetings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
            Aucun rendez-vous prévu pour {selectedLabel.toLowerCase()}.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {meetings.map((m) => (
              <MeetingCard key={m.key} meeting={m} showOwner={Boolean(team)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MeetingCard({ meeting, showOwner }: { meeting: DashboardMeeting; showOwner: boolean }) {
  const timeRange = meeting.allDay ? "Toute la journée" : `${timeLabel(meeting.start)} – ${timeLabel(meeting.end)}`;
  const typeLabel = meeting.activityType
    ? (ACTIVITY_LABEL[meeting.activityType as ActivityType] ?? meeting.activityType)
    : null;

  return (
    <article className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
              {timeRange}
            </span>
            {typeLabel && (
              <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                {typeLabel}
              </span>
            )}
            <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
              {meeting.source === "GOOGLE_CALENDAR" ? "Google Agenda" : "CRM"}
            </span>
          </div>
          {showOwner && (
            <span className="text-xs font-medium text-slate-600">{meeting.ownerName}</span>
          )}
        </div>

        <h4 className="text-sm font-semibold text-slate-950">{meeting.title}</h4>

        {/* Matched CRM Salon Info */}
        {meeting.salon && (
          <div className="space-y-1 rounded-lg border border-rose-100 bg-white p-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/salons/${meeting.salon.id}`}
                className="font-semibold text-rose-700 hover:underline"
              >
                {meeting.salon.name} →
              </Link>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLE[meeting.salon.status])}>
                {STATUS_LABEL[meeting.salon.status]}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-600">
              {meeting.salon.contactName && <span>Contact : {meeting.salon.contactName}</span>}
              {meeting.salon.phone && (
                <a href={`tel:${meeting.salon.phone}`} className="font-medium text-slate-800 hover:text-rose-700">
                  {meeting.salon.phone}
                </a>
              )}
              {meeting.salon.contactEmail && <span>{meeting.salon.contactEmail}</span>}
              {meeting.salon.instagram && (
                <a
                  href={`https://www.instagram.com/${meeting.salon.instagram}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-700 hover:underline"
                >
                  @{meeting.salon.instagram}
                </a>
              )}
            </div>
            {meeting.salon.address && (
              <p className="text-slate-600">
                <a
                  href={mapsUrl(meeting.salon.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-rose-700 hover:underline"
                >
                  📍 {meeting.salon.address}
                </a>
              </p>
            )}
            {meeting.salon.notes && (
              <p className="line-clamp-2 text-[11px] text-slate-500">{meeting.salon.notes}</p>
            )}
          </div>
        )}

        {/* Non-salon location / attendees / description */}
        {!meeting.isPrivate && (
          <div className="space-y-1 text-xs text-slate-600">
            {meeting.location && meeting.location !== meeting.salon?.address && (
              <p>
                <a href={mapsUrl(meeting.location)} target="_blank" rel="noreferrer" className="hover:underline">
                  📍 {meeting.location}
                </a>
              </p>
            )}
            {meeting.attendees.length > 0 && (
              <p className="truncate text-[11px] text-slate-500">
                Participants :{" "}
                {meeting.attendees
                  .map((a) => (a.displayName ? `${a.displayName} (${a.email})` : a.email))
                  .join(", ")}
              </p>
            )}
            {meeting.description && (
              <p className="line-clamp-3 whitespace-pre-line text-[11px] text-slate-500">
                {meeting.description}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      {!meeting.isPrivate && (meeting.meetUrl || meeting.calendarUrl || meeting.salon) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2.5 text-xs">
          {meeting.meetUrl && (
            <a
              href={meeting.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"
            >
              Rejoindre Google Meet
            </a>
          )}
          {meeting.calendarUrl && (
            <a
              href={meeting.calendarUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
            >
              Google Agenda
            </a>
          )}
          {meeting.salon && (
            <Link
              href={`/salons/${meeting.salon.id}`}
              className="ml-auto font-semibold text-rose-700 hover:underline"
            >
              Ouvrir la fiche →
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
