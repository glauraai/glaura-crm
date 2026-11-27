import { parisTime } from "@/lib/availability";
import { canonicalizePhone } from "@/lib/phone";
import { ACTIVITY_LABEL, BOOKING_LABEL } from "@/lib/labels";
import type { ActivityType, BookingTool, SalonStatus } from "@/generated/prisma/enums";

export type CalendarAttendee = {
  email: string;
  displayName?: string | null;
  responseStatus?: string | null;
  self?: boolean;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  htmlLink: string | null;
  meetUrl: string | null;
  visibility: string | null;
  attendees: CalendarAttendee[];
  salonId: string | null;
  activityType: string | null;
};

export type MatchableSalon = {
  id: string;
  name: string;
  status: SalonStatus;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  instagram: string | null;
  notes: string | null;
  bookingTool?: BookingTool | null;
  contacts?: Array<{ email: string | null; name?: string | null }>;
};

export type DashboardMeeting = {
  key: string;
  source: "GOOGLE_CALENDAR" | "CRM";
  ownerEmail: string;
  ownerName: string;
  title: string;
  activityType: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  meetUrl: string | null;
  calendarUrl: string | null;
  attendees: CalendarAttendee[];
  isPrivate: boolean;
  salon: MatchableSalon | null;
};

export const CALENDAR_SYNC_ACTIVITY_TYPES = new Set<string>(["VISITE", "VISIO"]);

/**
 * Parses `YYYY-MM-DD` + `HH:MM` wall-clock time in Europe/Paris (DST-safe) into a UTC Date.
 */
export function parseParisDateTimeInput(dateStr?: string | null, timeStr?: string | null): Date | null {
  const d = (dateStr ?? "").trim();
  const t = (timeStr ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(":").map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const baseHour = parisTime(d, hh);
  if (Number.isNaN(baseHour.getTime())) return null;
  return new Date(baseHour.getTime() + mm * 60_000);
}

function normalizeMatchText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildSalonCalendarEventPayload(input: {
  type: "VISITE" | "VISIO";
  start: Date;
  durationMin: number;
  notes?: string | null;
  inviteSalon: boolean;
  requestId: string;
  crmBaseUrl: string;
  salon: MatchableSalon;
}) {
  const duration = Math.max(15, Math.min(480, Math.round(input.durationMin || 45)));
  const end = new Date(input.start.getTime() + duration * 60_000);
  const label = ACTIVITY_LABEL[input.type as ActivityType] ?? input.type;
  const baseUrl = input.crmBaseUrl.replace(/\/+$/, "");

  const lines = [
    `Salon : ${input.salon.name}`,
    input.salon.contactName ? `Contact : ${input.salon.contactName}` : null,
    input.salon.phone ? `Téléphone : ${input.salon.phone}` : null,
    input.salon.contactEmail ? `Email : ${input.salon.contactEmail}` : null,
    input.salon.address ? `Adresse : ${input.salon.address}` : null,
    input.salon.instagram ? `Instagram : @${input.salon.instagram}` : null,
    input.salon.bookingTool ? `Outil actuel : ${BOOKING_LABEL[input.salon.bookingTool] ?? input.salon.bookingTool}` : null,
    input.notes?.trim() ? `\nNotes :\n${input.notes.trim()}` : null,
    `\nFiche CRM : ${baseUrl}/salons/${input.salon.id}`,
  ].filter(Boolean);

  const attendees =
    input.inviteSalon && input.salon.contactEmail?.trim()
      ? [
          {
            email: input.salon.contactEmail.trim(),
            displayName: input.salon.contactName?.trim() || input.salon.name,
          },
        ]
      : undefined;

  return {
    summary: `${label} — ${input.salon.name}`,
    description: lines.join("\n"),
    ...(input.type === "VISITE" && input.salon.address?.trim() ? { location: input.salon.address.trim() } : {}),
    start: { dateTime: input.start.toISOString(), timeZone: "Europe/Paris" },
    end: { dateTime: end.toISOString(), timeZone: "Europe/Paris" },
    ...(attendees ? { attendees } : {}),
    ...(input.type === "VISIO"
      ? {
          conferenceData: {
            createRequest: {
              requestId: input.requestId,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }
      : {}),
    extendedProperties: {
      private: {
        glauraSource: "glaura-crm",
        glauraSalonId: input.salon.id,
        glauraActivityType: input.type,
      },
    },
  };
}

/**
 * Matches a Google Calendar event to a CRM salon by:
 * 1) explicit extendedProperties.private.glauraSalonId
 * 2) attendee email matching Salon.contactEmail or Contact.email
 * 3) canonical French phone number in title/description/location
 * 4) normalized salon name (>= 4 chars) in title/description/location
 */
export function matchEventToSalon(event: CalendarEvent, salons: MatchableSalon[]): MatchableSalon | null {
  if (event.salonId) {
    const byId = salons.find((s) => s.id === event.salonId);
    if (byId) return byId;
  }

  const attendeeEmails = new Set(
    event.attendees
      .filter((a) => !a.self && a.email)
      .map((a) => a.email.trim().toLowerCase()),
  );
  if (attendeeEmails.size > 0) {
    for (const s of salons) {
      if (s.contactEmail && attendeeEmails.has(s.contactEmail.trim().toLowerCase())) return s;
      if (s.contacts?.some((c) => c.email && attendeeEmails.has(c.email.trim().toLowerCase()))) return s;
    }
  }

  const haystackRaw = [event.summary, event.description, event.location].filter(Boolean).join(" ");
  if (!haystackRaw.trim()) return null;

  const phoneMatches = haystackRaw.match(/(?:\+33|0033|0)[\s.\-/]*[1-9](?:[\s.\-/]?\d{2}){4}/g) ?? [];
  if (phoneMatches.length > 0) {
    const canonicalCandidates = new Set(phoneMatches.map((p) => canonicalizePhone(p)).filter((p) => p.length >= 9));
    for (const s of salons) {
      if (!s.phone) continue;
      const canon = canonicalizePhone(s.phone);
      if (canon.length >= 9 && canonicalCandidates.has(canon)) return s;
    }
  }

  const haystackNorm = ` ${normalizeMatchText(haystackRaw)} `;
  // Prefer longest matching salon name to avoid short ambiguous collisions.
  let best: { salon: MatchableSalon; len: number } | null = null;
  for (const s of salons) {
    const normName = normalizeMatchText(s.name);
    if (normName.length < 4) continue;
    if (haystackNorm.includes(` ${normName} `) && (!best || normName.length > best.len)) {
      best = { salon: s, len: normName.length };
    }
  }
  return best?.salon ?? null;
}

export function mergeCalendarAndCrmMeetings(input: {
  calendarEntries: Array<{
    ownerEmail: string;
    ownerName: string;
    maskPrivate: boolean;
    events: CalendarEvent[];
  }>;
  crmActivities: Array<{
    id: string;
    type: string;
    scheduledAt: Date;
    durationMin: number | null;
    notes: string | null;
    calendarEventId: string | null;
    calendarEventUrl: string | null;
    meetUrl: string | null;
    salon: MatchableSalon;
    ownerEmail: string;
    ownerName: string;
  }>;
  salons: MatchableSalon[];
}): DashboardMeeting[] {
  const syncedCalendarIds = new Set<string>();
  const crmByEventId = new Map(
    input.crmActivities
      .filter((a) => Boolean(a.calendarEventId))
      .map((a) => [a.calendarEventId!, a]),
  );

  const out: DashboardMeeting[] = [];

  for (const entry of input.calendarEntries) {
    for (const ev of entry.events) {
      syncedCalendarIds.add(ev.id);
      const isPrivate = ev.visibility === "private" || ev.visibility === "confidential";
      if (isPrivate && entry.maskPrivate) {
        out.push({
          key: `gcal:${entry.ownerEmail}:${ev.id}`,
          source: "GOOGLE_CALENDAR",
          ownerEmail: entry.ownerEmail,
          ownerName: entry.ownerName,
          title: "Occupé (privé)",
          activityType: null,
          start: ev.start,
          end: ev.end,
          allDay: ev.allDay,
          location: null,
          description: null,
          meetUrl: null,
          calendarUrl: null,
          attendees: [],
          isPrivate: true,
          salon: null,
        });
        continue;
      }

      const linkedCrm = crmByEventId.get(ev.id);
      const salon = linkedCrm?.salon ?? matchEventToSalon(ev, input.salons);
      out.push({
        key: `gcal:${entry.ownerEmail}:${ev.id}`,
        source: "GOOGLE_CALENDAR",
        ownerEmail: entry.ownerEmail,
        ownerName: entry.ownerName,
        title: ev.summary || "Rendez-vous",
        activityType: ev.activityType ?? linkedCrm?.type ?? (ev.meetUrl ? "VISIO" : null),
        start: ev.start,
        end: ev.end,
        allDay: ev.allDay,
        location: ev.location ?? (linkedCrm?.type === "VISITE" ? salon?.address ?? null : null),
        description: ev.description ?? linkedCrm?.notes ?? null,
        meetUrl: ev.meetUrl ?? linkedCrm?.meetUrl ?? null,
        calendarUrl: ev.htmlLink ?? linkedCrm?.calendarEventUrl ?? null,
        attendees: ev.attendees.filter((a) => !a.self),
        isPrivate,
        salon,
      });
    }
  }

  for (const act of input.crmActivities) {
    if (act.calendarEventId && syncedCalendarIds.has(act.calendarEventId)) continue;
    const durationMin = act.durationMin ?? 45;
    const label = ACTIVITY_LABEL[act.type as ActivityType] ?? act.type;
    out.push({
      key: `crm:${act.id}`,
      source: "CRM",
      ownerEmail: act.ownerEmail,
      ownerName: act.ownerName,
      title: `${label} — ${act.salon.name}`,
      activityType: act.type,
      start: act.scheduledAt,
      end: new Date(act.scheduledAt.getTime() + durationMin * 60_000),
      allDay: false,
      location: act.type === "VISITE" ? act.salon.address : null,
      description: act.notes,
      meetUrl: act.meetUrl,
      calendarUrl: act.calendarEventUrl,
      attendees: act.salon.contactEmail ? [{ email: act.salon.contactEmail, displayName: act.salon.contactName }] : [],
      isPrivate: false,
      salon: act.salon,
    });
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
