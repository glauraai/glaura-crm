"use client";

import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_LABEL } from "@/lib/labels";
import { SubmitButton } from "@/components/SubmitButton";
import { FrenchDatePicker } from "@/components/FrenchDatePicker";
import {
  findSlotConflicts,
  parseParisDateTimeInput,
  suggestFreeTimes,
  toDaySlot,
  type DaySlot,
} from "@/lib/calendar-sync";
import type { ActivityType } from "@/generated/prisma/enums";

const ACT_TYPES: readonly ActivityType[] = [
  "APPEL",
  "VISIO",
  "VISITE",
  "RELANCE",
  "EMAIL",
  "DEMO",
  "NOTE",
];

const DURATIONS = [30, 45, 60, 90] as const;
const HOURS_TICKS = [8, 10, 12, 14, 16, 18, 20] as const;
const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100";

type DayAvailabilityResponse = {
  date: string;
  calendarConnected: boolean;
  unavailable: boolean;
  slots: DaySlot[];
};

export function ActivityLogForm({
  action,
  salon,
  defaultDate,
}: {
  action: (fd: FormData) => Promise<void>;
  salon: { name: string; address: string | null; contactEmail: string | null };
  defaultDate: string;
}) {
  const [type, setType] = useState<ActivityType>("APPEL");
  const [scheduledDate, setScheduledDate] = useState(defaultDate);
  const [scheduledTime, setScheduledTime] = useState("");
  const [durationMin, setDurationMin] = useState<number>(45);
  const [syncCalendar, setSyncCalendar] = useState(true);
  const [inviteSalon, setInviteSalon] = useState(false);
  const [forceConflict, setForceConflict] = useState(false);

  const [agenda, setAgenda] = useState<DayAvailabilityResponse | null>(null);

  const isCalendarMeeting = type === "VISITE" || type === "VISIO";
  const hasEmail = Boolean(salon.contactEmail?.trim());
  const showAgendaPreview = Boolean(scheduledDate) && (isCalendarMeeting || Boolean(scheduledTime));
  const loadingAgenda = Boolean(scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) && agenda?.date !== scheduledDate);

  useEffect(() => {
    if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return;
    const ctrl = new AbortController();
    fetch(`/api/calendar/day?date=${encodeURIComponent(scheduledDate)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<DayAvailabilityResponse>) : null))
      .then((data) => {
        if (data) setAgenda(data);
      })
      .catch(() => {
        // Ignore aborts / transient errors cleanly
      });
    return () => ctrl.abort();
  }, [scheduledDate]);

  const proposedStart = useMemo(
    () => parseParisDateTimeInput(scheduledDate, scheduledTime),
    [scheduledDate, scheduledTime],
  );

  const proposedBar = useMemo(() => {
    if (!proposedStart || !scheduledDate) return null;
    const end = new Date(proposedStart.getTime() + durationMin * 60_000);
    return toDaySlot({ id: "proposed", start: proposedStart, end, title: "Nouveau créneau" }, scheduledDate);
  }, [proposedStart, scheduledDate, durationMin]);

  const slotsForDate = useMemo(
    () => (agenda?.date === scheduledDate ? agenda.slots : []),
    [agenda, scheduledDate],
  );

  const conflicts = useMemo(() => {
    if (!proposedStart) return [];
    return findSlotConflicts(proposedStart, durationMin, slotsForDate);
  }, [proposedStart, durationMin, slotsForDate]);

  const freeTimes = useMemo(() => {
    if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return [];
    return suggestFreeTimes(scheduledDate, durationMin, slotsForDate, 6);
  }, [scheduledDate, durationMin, slotsForDate]);

  const hasUnresolvedConflict = conflicts.length > 0 && !forceConflict;

  function handleTypeChange(next: ActivityType) {
    const wasCalendar = type === "VISIO" || type === "VISITE";
    setType(next);
    setForceConflict(false);
    if (next === "VISIO") {
      setSyncCalendar(true);
      setInviteSalon(hasEmail);
      if (!scheduledTime) setScheduledTime(freeTimes[0] ?? "10:00");
    } else if (next === "VISITE") {
      setSyncCalendar(true);
      setInviteSalon(false);
      if (!scheduledTime) setScheduledTime(freeTimes[0] ?? "10:00");
    } else if (wasCalendar && scheduledTime === "10:00") {
      setScheduledTime("");
    }
  }

  return (
    <form action={action} className="space-y-2.5">
      <select
        name="type"
        value={type}
        onChange={(e) => handleTypeChange(e.target.value as ActivityType)}
        className={field}
      >
        {ACT_TYPES.map((t) => (
          <option key={t} value={t}>
            {ACTIVITY_LABEL[t]}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-2">
        <div className="text-[11px] font-medium text-slate-500">
          <span className="block">Date</span>
          <FrenchDatePicker
            name="scheduledDate"
            value={scheduledDate}
            today={defaultDate}
            onChange={(next) => {
              setScheduledDate(next);
              setForceConflict(false);
            }}
            className={`${field} mt-0.5 h-9 px-2.5 text-xs`}
          />
        </div>
        <label className="text-[11px] font-medium text-slate-500">
          Heure {isCalendarMeeting && syncCalendar ? "*" : "(optionnel)"}
          <input
            type="time"
            name="scheduledTime"
            value={scheduledTime}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                // Unsupported in some webviews
              }
            }}
            onChange={(e) => {
              setScheduledTime(e.target.value);
              setForceConflict(false);
            }}
            required={isCalendarMeeting && syncCalendar}
            className={`${field} mt-0.5 h-9 px-2 text-xs`}
          />
        </label>
      </div>

      {(isCalendarMeeting || scheduledTime) && (
        <label className="block text-[11px] font-medium text-slate-500">
          Durée
          <select
            name="durationMin"
            value={durationMin}
            onChange={(e) => {
              setDurationMin(Number(e.target.value));
              setForceConflict(false);
            }}
            className={`${field} mt-0.5 h-9 px-2 text-xs`}
          >
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Inline Google Agenda availability & conflict checker */}
      {showAgendaPreview && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-800">Mon agenda du jour</span>
            {loadingAgenda ? (
              <span className="text-[11px] text-slate-400">Chargement…</span>
            ) : agenda?.unavailable ? (
              <span className="text-[11px] text-amber-700">Google Agenda indisponible</span>
            ) : slotsForDate.length === 0 ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                Libre
              </span>
            ) : (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                {slotsForDate.length} créneau{slotsForDate.length > 1 ? "x" : ""} occupé{slotsForDate.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* 8h-20h visual timeline bar */}
          <div>
            <div className="mb-0.5 flex justify-between text-[10px] text-slate-400">
              {HOURS_TICKS.map((h) => (
                <span key={h}>{h}h</span>
              ))}
            </div>
            <div className="relative h-5 overflow-hidden rounded bg-emerald-50 ring-1 ring-slate-200">
              {HOURS_TICKS.slice(1, -1).map((h) => (
                <span
                  key={h}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-slate-200/80"
                  style={{ left: `${((h - 8) / 12) * 100}%` }}
                />
              ))}
              {slotsForDate
                .filter((s) => !s.allDay && s.widthPct > 0)
                .map((s) => (
                  <span
                    key={s.id}
                    title={`${s.startLabel}–${s.endLabel} · ${s.title}`}
                    className="absolute inset-y-0.5 rounded bg-rose-400/90"
                    style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%` }}
                  />
                ))}
              {proposedBar && proposedBar.widthPct > 0 && (
                <span
                  title={`Nouveau créneau : ${proposedBar.startLabel}–${proposedBar.endLabel}`}
                  className={`absolute inset-y-0 rounded border ${
                    conflicts.length > 0
                      ? "border-rose-700 bg-rose-600/55"
                      : "border-indigo-700 bg-indigo-500/75"
                  }`}
                  style={{ left: `${proposedBar.leftPct}%`, width: `${proposedBar.widthPct}%` }}
                />
              )}
            </div>
          </div>

          {/* Existing busy slots list */}
          {slotsForDate.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-slate-600">
              {slotsForDate.slice(0, 4).map((s) => (
                <li key={s.id} className="flex items-center gap-1.5 truncate">
                  <span className="shrink-0 font-medium text-slate-800">
                    {s.allDay ? "Journée" : `${s.startLabel}–${s.endLabel}`}
                  </span>
                  <span className="truncate text-slate-500">· {s.title}</span>
                </li>
              ))}
              {slotsForDate.length > 4 && (
                <li className="text-[10px] text-slate-400">+{slotsForDate.length - 4} autre(s)</li>
              )}
            </ul>
          )}

          {/* 1-click free slot suggestions */}
          {freeTimes.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium text-slate-500">Créneaux libres ({durationMin} min) :</p>
              <div className="flex flex-wrap gap-1">
                {freeTimes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setScheduledTime(t);
                      setForceConflict(false);
                    }}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                      scheduledTime === t
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-indigo-50 hover:text-indigo-700"
                    }`}
                  >
                    {t.replace(":", "h")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conflict warning + explicit override */}
          {conflicts.length > 0 && (
            <div role="alert" className="space-y-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800">
              <p className="font-semibold">
                Conflit agenda : {conflicts.map((c) => `${c.startLabel}–${c.endLabel} (${c.title})`).join(", ")}
              </p>
              <label className="flex items-center gap-1.5 text-rose-900">
                <input
                  type="checkbox"
                  checked={forceConflict}
                  onChange={(e) => setForceConflict(e.target.checked)}
                />
                Réserver quand même malgré le conflit
              </label>
            </div>
          )}
        </div>
      )}

      {isCalendarMeeting && (
        <div className="space-y-1.5 rounded-lg border border-indigo-100 bg-indigo-50/60 p-2.5 text-xs text-slate-700">
          <label className="flex items-center gap-2 font-medium text-indigo-950">
            <input
              type="checkbox"
              name="syncCalendar"
              checked={syncCalendar}
              onChange={(e) => setSyncCalendar(e.target.checked)}
            />
            Créer l’événement dans Google Agenda
          </label>
          {syncCalendar && (
            <>
              <p className="text-[11px] text-indigo-800">
                {type === "VISIO"
                  ? "Lien Google Meet + fiche salon ajoutés automatiquement."
                  : `Adresse (${salon.address ?? "non renseignée"}) + fiche salon ajoutées automatiquement.`}
              </p>
              <label className={`flex items-center gap-2 text-[11px] ${hasEmail ? "text-slate-700" : "text-slate-400"}`}>
                <input
                  type="checkbox"
                  name="inviteSalon"
                  checked={hasEmail && inviteSalon}
                  disabled={!hasEmail}
                  onChange={(e) => setInviteSalon(e.target.checked)}
                />
                {hasEmail
                  ? `Inviter le salon (${salon.contactEmail})`
                  : "Inviter le salon (aucun email renseigné)"}
              </label>
            </>
          )}
        </div>
      )}

      <textarea name="notes" rows={2} className={textareaField} placeholder="Notes…" />

      <SubmitButton
        disabled={hasUnresolvedConflict}
        className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {hasUnresolvedConflict
          ? "Choisissez un créneau libre"
          : isCalendarMeeting && syncCalendar
            ? "Planifier & ajouter à l’agenda"
            : "Enregistrer"}
      </SubmitButton>
    </form>
  );
}
