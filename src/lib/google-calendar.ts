import { JWT } from "google-auth-library";
import type { Interval } from "@/lib/availability";

// Reads reps' busy slots from Google Calendar (free/busy only: no titles, no
// attendees). Auth: the glaura-crm-calendar service account, authorised by the
// Workspace admin for domain-wide delegation on the calendar.freebusy scope.
// Its JSON key lives base64-encoded in GOOGLE_CALENDAR_SA_KEY (server env only).

const SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const CACHE_MS = 2 * 60_000;
const TIMEOUT_MS = 5_000;

export type BusyResult = { busy: Interval[] } | { error: string };

let credentials: { client_email: string; private_key: string } | null | undefined;
const cache = new Map<string, { at: number; value: BusyResult }>();

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

async function fetchBusy(email: string, timeMin: Date, timeMax: Date): Promise<BusyResult> {
  const sa = serviceAccount();
  if (!sa) return { error: "not_configured" };
  // Impersonate the rep and read their own calendar: works whatever their
  // calendar sharing settings are.
  const client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [SCOPE], subject: email });
  try {
    const res = await client.request<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>({
      url: "https://www.googleapis.com/calendar/v3/freeBusy",
      method: "POST",
      timeout: TIMEOUT_MS,
      data: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: email }] },
    });
    const calendar = res.data.calendars?.[email];
    if (!calendar || calendar.errors?.length) return { error: "calendar_unavailable" };
    return { busy: (calendar.busy ?? []).map(b => ({ start: new Date(b.start), end: new Date(b.end) })) };
  } catch (error) {
    // Typical: the address is not a Workspace account (unauthorized_client / invalid_grant).
    console.error("[calendar] free/busy lookup failed", { email, error: error instanceof Error ? error.message : error });
    return { error: "calendar_unavailable" };
  }
}

/** Busy slots per email between two instants. Never throws. */
export async function getBusySlots(emails: string[], timeMin: Date, timeMax: Date): Promise<Map<string, BusyResult>> {
  const entries = await Promise.all([...new Set(emails.map(e => e.trim().toLowerCase()))].map(async email => {
    const key = `${email}|${timeMin.toISOString()}|${timeMax.toISOString()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return [email, hit.value] as const;
    const value = await fetchBusy(email, timeMin, timeMax);
    if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k);
    cache.set(key, { at: Date.now(), value });
    return [email, value] as const;
  }));
  return new Map(entries);
}
