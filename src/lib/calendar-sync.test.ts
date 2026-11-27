import { describe, expect, it } from "vitest";
import {
  buildSalonCalendarEventPayload,
  findSlotConflicts,
  matchEventToSalon,
  mergeCalendarAndCrmMeetings,
  parseParisDateTimeInput,
  suggestFreeTimes,
  toDaySlot,
  type CalendarEvent,
  type MatchableSalon,
} from "./calendar-sync";

const SALONS: MatchableSalon[] = [
  {
    id: "salon-1",
    name: "Maison Éclat Paris",
    status: "INTERESSE",
    contactName: "Claire Moreau",
    contactEmail: "claire@maison-eclat.fr",
    phone: "06 12 34 56 78",
    address: "18 Rue des Martyrs, 75009 Paris",
    instagram: "maisoneclatparis",
    notes: "Intéressée par Laura Instagram",
    bookingTool: "PLANITY",
    contacts: [{ email: "associee@maison-eclat.fr", name: "Léa" }],
  },
  {
    id: "salon-2",
    name: "Atelier Ongles Neuilly",
    status: "A_VISITER",
    contactName: "Sophie Martin",
    contactEmail: "contact@atelier-ongles.fr",
    phone: "+33 1 42 55 66 77",
    address: "42 Avenue Charles de Gaulle, 92200 Neuilly",
    instagram: null,
    notes: null,
    bookingTool: "NONE",
    contacts: [],
  },
];

describe("calendar-sync helpers", () => {
  it("parses Paris local date + time across winter (UTC+1) and summer (UTC+2)", () => {
    const winter = parseParisDateTimeInput("2026-11-27", "14:30");
    expect(winter?.toISOString()).toBe("2026-11-27T13:30:00.000Z");

    const summer = parseParisDateTimeInput("2026-07-15", "10:15");
    expect(summer?.toISOString()).toBe("2026-07-15T08:15:00.000Z");

    expect(parseParisDateTimeInput("", "10:00")).toBeNull();
    expect(parseParisDateTimeInput("2026-11-27", "99:99")).toBeNull();
  });

  it("builds a VISIO Google Calendar event with Google Meet, salon details, and optional invite", () => {
    const start = new Date("2026-11-27T13:00:00.000Z");
    const payload = buildSalonCalendarEventPayload({
      type: "VISIO",
      start,
      durationMin: 45,
      notes: "Démo complète + devis annuel",
      inviteSalon: true,
      requestId: "req-123",
      crmBaseUrl: "https://crm.glaura.ai",
      salon: SALONS[0],
    });

    expect(payload.summary).toBe("Visio — Maison Éclat Paris");
    expect(payload.end.dateTime).toBe("2026-11-27T13:45:00.000Z");
    expect(payload.conferenceData).toEqual({
      createRequest: {
        requestId: "req-123",
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    });
    expect(payload.attendees).toEqual([
      { email: "claire@maison-eclat.fr", displayName: "Claire Moreau" },
    ]);
    expect(payload.location).toBeUndefined();
    expect(payload.description).toContain("https://crm.glaura.ai/salons/salon-1");
    expect(payload.description).toContain("06 12 34 56 78");
    expect(payload.description).toContain("Démo complète + devis annuel");
    expect(payload.extendedProperties?.private).toEqual({
      glauraSource: "glaura-crm",
      glauraSalonId: "salon-1",
      glauraActivityType: "VISIO",
    });
  });

  it("builds a VISITE event with salon address, no Meet request, and no attendee when inviteSalon is false", () => {
    const start = new Date("2026-11-27T09:00:00.000Z");
    const payload = buildSalonCalendarEventPayload({
      type: "VISITE",
      start,
      durationMin: 60,
      notes: null,
      inviteSalon: false,
      requestId: "req-456",
      crmBaseUrl: "https://crm.glaura.ai",
      salon: SALONS[0],
    });

    expect(payload.summary).toBe("Visite — Maison Éclat Paris");
    expect(payload.location).toBe("18 Rue des Martyrs, 75009 Paris");
    expect(payload.conferenceData).toBeUndefined();
    expect(payload.attendees).toBeUndefined();
  });

  it("matches Google Calendar events to CRM salons by salonId, attendee email, phone, or salon name", () => {
    const baseEvent: CalendarEvent = {
      id: "ev-1",
      summary: "Démo Glaura",
      description: null,
      location: null,
      start: new Date("2026-11-27T10:00:00.000Z"),
      end: new Date("2026-11-27T10:45:00.000Z"),
      allDay: false,
      htmlLink: "https://calendar.google.com/event?eid=1",
      meetUrl: "https://meet.google.com/abc-defg-hij",
      visibility: null,
      attendees: [],
      salonId: null,
      activityType: null,
    };

    // 1. Direct metadata match
    expect(matchEventToSalon({ ...baseEvent, salonId: "salon-2" }, SALONS)?.id).toBe("salon-2");

    // 2. Attendee email match (secondary contact)
    expect(
      matchEventToSalon(
        { ...baseEvent, attendees: [{ email: "ASSOCIEE@maison-eclat.fr" }] },
        SALONS,
      )?.id,
    ).toBe("salon-1");

    // 3. Phone number in Google Appointment Schedule description
    expect(
      matchEventToSalon(
        { ...baseEvent, description: "Réservé par téléphone : +33 6 12 34 56 78" },
        SALONS,
      )?.id,
    ).toBe("salon-1");

    // 4. Salon name in event title
    expect(
      matchEventToSalon(
        { ...baseEvent, summary: "RDV Atelier Ongles Neuilly (Glaura)" },
        SALONS,
      )?.id,
    ).toBe("salon-2");
  });

  it("merges Google Calendar + CRM scheduled activities without duplicating synced events and masks private events on team view", () => {
    const calendarEvents: CalendarEvent[] = [
      {
        id: "gcal-1",
        summary: "Visio — Maison Éclat Paris",
        description: "Synced from CRM",
        location: null,
        start: new Date("2026-11-27T10:00:00.000Z"),
        end: new Date("2026-11-27T10:45:00.000Z"),
        allDay: false,
        htmlLink: "https://calendar.google.com/event?eid=1",
        meetUrl: "https://meet.google.com/xyz",
        visibility: "default",
        attendees: [{ email: "claire@maison-eclat.fr" }],
        salonId: "salon-1",
        activityType: "VISIO",
      },
      {
        id: "gcal-priv",
        summary: "Médecin perso",
        description: "Privé",
        location: "Cabinet",
        start: new Date("2026-11-27T15:00:00.000Z"),
        end: new Date("2026-11-27T16:00:00.000Z"),
        allDay: false,
        htmlLink: "https://calendar.google.com/event?eid=2",
        meetUrl: null,
        visibility: "private",
        attendees: [],
        salonId: null,
        activityType: null,
      },
    ];

    const crmActivities = [
      {
        id: "act-1",
        type: "VISIO",
        scheduledAt: new Date("2026-11-27T10:00:00.000Z"),
        durationMin: 45,
        notes: "Note CRM",
        calendarEventId: "gcal-1", // already in calendarEvents -> dedupe!
        calendarEventUrl: "https://calendar.google.com/event?eid=1",
        meetUrl: "https://meet.google.com/xyz",
        salon: SALONS[0],
        ownerEmail: "rep@glaura.fr",
        ownerName: "Simone",
      },
      {
        id: "act-2",
        type: "VISITE",
        scheduledAt: new Date("2026-11-27T13:00:00.000Z"),
        durationMin: 60,
        notes: "Visite terrain",
        calendarEventId: null,
        calendarEventUrl: null,
        meetUrl: null,
        salon: SALONS[1],
        ownerEmail: "rep@glaura.fr",
        ownerName: "Simone",
      },
    ];

    const mergedTeam = mergeCalendarAndCrmMeetings({
      calendarEntries: [{ ownerEmail: "rep@glaura.fr", ownerName: "Simone", maskPrivate: true, events: calendarEvents }],
      crmActivities,
      salons: SALONS,
    });

    expect(mergedTeam).toHaveLength(3);
    expect(mergedTeam[0].salon?.id).toBe("salon-1");
    expect(mergedTeam[0].meetUrl).toBe("https://meet.google.com/xyz");
    expect(mergedTeam[1].source).toBe("CRM");
    expect(mergedTeam[1].salon?.id).toBe("salon-2");
    expect(mergedTeam[2].isPrivate).toBe(true);
    expect(mergedTeam[2].title).toBe("Occupé (privé)");
    expect(mergedTeam[2].description).toBeNull();
  });

  it("detects slot conflicts accurately, ignores all-day banners, and suggests free slots", () => {
    const day = "2026-12-01";
    const s1 = toDaySlot(
      {
        id: "ev-1",
        start: parseParisDateTimeInput(day, "12:00")!,
        end: parseParisDateTimeInput(day, "13:00")!,
        title: "Visite — EMMA BEAUTY",
      },
      day,
    )!;
    const allDay = toDaySlot(
      {
        id: "ev-all",
        start: parseParisDateTimeInput(day, "08:00")!,
        end: parseParisDateTimeInput(day, "20:00")!,
        title: "Salon professionnel",
        allDay: true,
      },
      day,
    )!;

    // Exact overlap -> conflict
    expect(findSlotConflicts(parseParisDateTimeInput(day, "12:30")!, 45, [s1, allDay])).toHaveLength(1);
    // Touching boundary (13:00 after 12:00–13:00) -> no conflict
    expect(findSlotConflicts(parseParisDateTimeInput(day, "13:00")!, 45, [s1, allDay])).toHaveLength(0);
    // Free times should exclude 12:00 and include 09:00, 10:00, 11:00, 14:00...
    const free = suggestFreeTimes(day, 60, [s1, allDay], 6);
    expect(free).not.toContain("12:00");
    expect(free).toContain("10:00");
    expect(free).toContain("14:00");
  });
});
