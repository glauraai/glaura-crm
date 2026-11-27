import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parisDay, parisTime } from "@/lib/availability";
import { toDaySlot, type DaySlot } from "@/lib/calendar-sync";
import { calendarConfigured, getBusySlots, getCalendarEvents } from "@/lib/google-calendar";
import { ACTIVITY_LABEL } from "@/lib/labels";
import type { ActivityType } from "@/generated/prisma/enums";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawDate = searchParams.get("date")?.trim();
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : parisDay(new Date());
  const dayStart = parisTime(date, 0);
  const dayEnd = parisTime(date, 24);
  const email = session.user.email?.trim().toLowerCase() ?? "";

  const calConnected = calendarConfigured();
  let unavailable = false;
  const slots: DaySlot[] = [];
  const seenEventIds = new Set<string>();

  if (calConnected && email) {
    const eventsMap = await getCalendarEvents([email], dayStart, dayEnd);
    const evRes = eventsMap.get(email);
    if (evRes && "events" in evRes) {
      for (const ev of evRes.events) {
        seenEventIds.add(ev.id);
        const projected = toDaySlot(
          { id: ev.id, start: ev.start, end: ev.end, title: ev.summary, allDay: ev.allDay },
          date,
        );
        if (projected) slots.push(projected);
      }
    } else if (evRes && "error" in evRes && evRes.error === "events_scope_required") {
      const busyMap = await getBusySlots([email], dayStart, dayEnd);
      const bRes = busyMap.get(email);
      if (bRes && "busy" in bRes) {
        bRes.busy.forEach((b, i) => {
          const projected = toDaySlot(
            { id: `busy-${i}`, start: b.start, end: b.end, title: "Occupé (Google Agenda)" },
            date,
          );
          if (projected) slots.push(projected);
        });
      } else {
        unavailable = true;
      }
    } else {
      unavailable = true;
    }
  }

  // Also merge CRM scheduled activities for this rep so local/non-synced meetings never double-book
  const crmActs = await prisma.activity.findMany({
    where: {
      userId: session.user.id,
      scheduledAt: { gte: dayStart, lt: dayEnd },
      salon: { archivedAt: null },
    },
    select: {
      id: true,
      type: true,
      scheduledAt: true,
      durationMin: true,
      calendarEventId: true,
      salon: { select: { name: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });

  for (const act of crmActs) {
    if (!act.scheduledAt) continue;
    if (act.calendarEventId && seenEventIds.has(act.calendarEventId)) continue;
    const end = new Date(act.scheduledAt.getTime() + (act.durationMin ?? 45) * 60_000);
    const label = ACTIVITY_LABEL[act.type as ActivityType] ?? act.type;
    const projected = toDaySlot(
      { id: `crm-${act.id}`, start: act.scheduledAt, end, title: `${label} — ${act.salon.name}` },
      date,
    );
    if (projected) slots.push(projected);
  }

  slots.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());

  return NextResponse.json({
    date,
    calendarConnected: calConnected,
    unavailable,
    slots,
  });
}
