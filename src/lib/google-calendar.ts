import { randomUUID } from "node:crypto";
import { JWT } from "google-auth-library";
import type { Interval } from "@/lib/availability";
import {
  buildSalonCalendarEventPayload,
  type CalendarEvent,
  type MatchableSalon,
} from "@/lib/calendar-sync";

// Google Calendar integration via the glaura-crm-calendar service account
// (Google Workspace Domain-Wide Delegation, base64 JSON in GOOGLE_CALENDAR_SA_KEY).
// - Busy timeline uses `calendar.freebusy`
// - 2-way meeting details & event creation use `calendar.events` (with graceful fallback to freebusy).

const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CACHE_MS = 2 * 60_000;
const TIMEOUT_MS = 6_000;

export type BusyResult = { busy: Interval[] } | { error: string };
export type EventsResult = { events: CalendarEvent[] } | { error: string };
export type CreateEventResult =
  | { ok: true; eventId: string; htmlLink: string | null; meetUrl: string | null }
  | { ok: false; error: string };

let credentials: { client_email: string; private_key: string } | null | undefined;
const busyCache = new Map<string, { at: number; value: BusyResult }>();
const eventsCache = new Map<string, { at: number; value: EventsResult }>();

function serviceAccount() {
  if (credentials !== undefined) return credentials;
  try {
    const raw = process.env.GOOGLE_CALENDAR_SA_KEY;
    credentials = raw ? JSON.parse(Buffer.from(raw, "base64").toString("utf8")) : null;
  } catch (error) {
    console.error("[calendar] GOOGLE_CALENDAR_SA_KEY is not valid base64 JSON", error);
    credentials = null;
  }
  return credentials;
}

export function calendarConfigured(): boolean {
  return Boolean(serviceAccount());
}

function invalidateCacheFor(email: string) {
  const prefix = `${email.trim().toLowerCase()}|`;
  for (const key of busyCache.keys()) if (key.startsWith(prefix)) busyCache.delete(key);
  for (const key of eventsCache.keys()) if (key.startsWith(prefix)) eventsCache.delete(key);
}

type GoogleRawEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  visibility?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean }>;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  extendedProperties?: { private?: Record<string, string> };
};

function parseGoogleEvent(raw: GoogleRawEvent): CalendarEvent | null {
  if (!raw.id || raw.status === "cancelled") return null;
  const startRaw = raw.start?.dateTime ?? raw.start?.date;
  const endRaw = raw.end?.dateTime ?? raw.end?.date;
  if (!startRaw || !endRaw) return null;
  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  const start = new Date(allDay ? `${startRaw}T08:00:00Z` : startRaw);
  const end = new Date(allDay ? `${endRaw}T08:00:00Z` : endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const videoEntry = raw.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video" && ep.uri)?.uri;
  const meetUrl = raw.hangoutLink ?? videoEntry ?? null;
  const priv = raw.extendedProperties?.private ?? {};

  return {
    id: raw.id,
    summary: raw.summary?.trim() || "Rendez-vous",
    description: raw.description?.trim() || null,
    location: raw.location?.trim() || null,
    start,
    end,
    allDay,
    htmlLink: raw.htmlLink ?? null,
    meetUrl,
    visibility: raw.visibility ?? null,
    attendees: (raw.attendees ?? [])
      .filter((a) => Boolean(a.email))
      .map((a) => ({
        email: a.email!,
        displayName: a.displayName ?? null,
        responseStatus: a.responseStatus ?? null,
        self: a.self ?? false,
      })),
    salonId: priv.glauraSalonId ?? null,
    activityType: priv.glauraActivityType ?? null,
  };
}

function isScopeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /unauthorized_client|insufficient|forbidden|403|access_denied/i.test(msg);
}

async function fetchBusy(email: string, timeMin: Date, timeMax: Date): Promise<BusyResult> {
  const sa = serviceAccount();
  if (!sa) return { error: "not_configured" };
  const client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [FREEBUSY_SCOPE], subject: email });
  try {
    const res = await client.request<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>({
      url: "https://www.googleapis.com/calendar/v3/freeBusy",
      method: "POST",
      timeout: TIMEOUT_MS,
      data: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: email }] },
    });
    const calendar = res.data.calendars?.[email];
    if (!calendar || calendar.errors?.length) return { error: "calendar_unavailable" };
    return { busy: (calendar.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })) };
  } catch (error) {
    console.error("[calendar] free/busy lookup failed", { email, error: error instanceof Error ? error.message : error });
    return { error: "calendar_unavailable" };
  }
}

/** Busy slots per email between two instants. Never throws. */
export async function getBusySlots(emails: string[], timeMin: Date, timeMax: Date): Promise<Map<string, BusyResult>> {
  const entries = await Promise.all([...new Set(emails.map((e) => e.trim().toLowerCase()))].map(async (email) => {
    const key = `${email}|${timeMin.toISOString()}|${timeMax.toISOString()}`;
    const hit = busyCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return [email, hit.value] as const;
    const value = await fetchBusy(email, timeMin, timeMax);
    if (busyCache.size > 500) for (const [k, v] of busyCache) if (Date.now() - v.at >= CACHE_MS) busyCache.delete(k);
    busyCache.set(key, { at: Date.now(), value });
    return [email, value] as const;
  }));
  return new Map(entries);
}

async function fetchEvents(email: string, timeMin: Date, timeMax: Date): Promise<EventsResult> {
  const sa = serviceAccount();
  if (!sa) return { error: "not_configured" };
  const client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [EVENTS_SCOPE], subject: email });
  try {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("maxResults", "100");

    const res = await client.request<{ items?: GoogleRawEvent[] }>({
      url: url.toString(),
      method: "GET",
      timeout: TIMEOUT_MS,
    });
    const events = (res.data.items ?? []).map(parseGoogleEvent).filter((e): e is CalendarEvent => Boolean(e));
    return { events };
  } catch (error) {
    if (isScopeError(error)) return { error: "events_scope_required" };
    console.error("[calendar] events lookup failed", { email, error: error instanceof Error ? error.message : error });
    return { error: "calendar_unavailable" };
  }
}

/** Full Google Calendar events per email between two instants. Never throws. */
export async function getCalendarEvents(emails: string[], timeMin: Date, timeMax: Date): Promise<Map<string, EventsResult>> {
  const entries = await Promise.all([...new Set(emails.map((e) => e.trim().toLowerCase()))].map(async (email) => {
    const key = `${email}|${timeMin.toISOString()}|${timeMax.toISOString()}`;
    const hit = eventsCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return [email, hit.value] as const;
    const value = await fetchEvents(email, timeMin, timeMax);
    if (eventsCache.size > 500) for (const [k, v] of eventsCache) if (Date.now() - v.at >= CACHE_MS) eventsCache.delete(k);
    eventsCache.set(key, { at: Date.now(), value });
    return [email, value] as const;
  }));
  return new Map(entries);
}

/**
 * Creates a VISITE or VISIO event in the rep's Google Calendar with salon details
 * (and auto-generated Google Meet link for VISIO). Never throws.
 */
export async function createSalonCalendarEvent(input: {
  organizerEmail: string;
  type: "VISITE" | "VISIO";
  start: Date;
  durationMin: number;
  notes?: string | null;
  inviteSalon: boolean;
  salon: MatchableSalon;
}): Promise<CreateEventResult> {
  const sa = serviceAccount();
  if (!sa) {
    return { ok: false, error: "Google Agenda non configuré sur cet environnement — activité enregistrée dans le CRM uniquement." };
  }
  const email = input.organizerEmail.trim().toLowerCase();
  const client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [EVENTS_SCOPE], subject: email });
  const crmBaseUrl = process.env.NEXTAUTH_URL?.trim() || "https://crm.glaura.ai";
  const payload = buildSalonCalendarEventPayload({
    type: input.type,
    start: input.start,
    durationMin: input.durationMin,
    notes: input.notes,
    inviteSalon: input.inviteSalon,
    requestId: `glaura-${randomUUID()}`,
    crmBaseUrl,
    salon: input.salon,
  });

  try {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    if (input.type === "VISIO") url.searchParams.set("conferenceDataVersion", "1");
    url.searchParams.set("sendUpdates", input.inviteSalon && input.salon.contactEmail ? "all" : "none");

    const res = await client.request<GoogleRawEvent>({
      url: url.toString(),
      method: "POST",
      timeout: TIMEOUT_MS,
      data: payload,
    });
    invalidateCacheFor(email);
    const parsed = parseGoogleEvent(res.data);
    return {
      ok: true,
      eventId: res.data.id ?? "",
      htmlLink: parsed?.htmlLink ?? res.data.htmlLink ?? null,
      meetUrl: parsed?.meetUrl ?? res.data.hangoutLink ?? null,
    };
  } catch (error) {
    if (isScopeError(error)) {
      return {
        ok: false,
        error: "Activité enregistrée au CRM. Ajoutez le scope Google Workspace `calendar.events` pour activer la création automatique dans Google Agenda.",
      };
    }
    const message = error instanceof Error ? error.message : "Erreur Google Agenda";
    console.error("[calendar] create event failed", { email, message });
    return { ok: false, error: `Activité enregistrée au CRM, mais création Google Agenda impossible (${message}).` };
  }
}
