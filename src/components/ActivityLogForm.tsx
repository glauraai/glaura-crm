"use client";

import { useState } from "react";
import { ACTIVITY_LABEL } from "@/lib/labels";
import { SubmitButton } from "@/components/SubmitButton";
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
const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100";

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

  const isCalendarMeeting = type === "VISITE" || type === "VISIO";
  const hasEmail = Boolean(salon.contactEmail?.trim());

  function handleTypeChange(next: ActivityType) {
    setType(next);
    if (next === "VISIO") {
      setSyncCalendar(true);
      setInviteSalon(hasEmail);
      if (!scheduledTime) setScheduledTime("10:00");
    } else if (next === "VISITE") {
      setSyncCalendar(true);
      setInviteSalon(false);
      if (!scheduledTime) setScheduledTime("10:00");
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
        <label className="text-[11px] font-medium text-slate-500">
          Date
          <input
            type="date"
            name="scheduledDate"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            required={isCalendarMeeting && syncCalendar}
            className={`${field} mt-0.5 h-9 px-2 text-xs`}
          />
        </label>
        <label className="text-[11px] font-medium text-slate-500">
          Heure {isCalendarMeeting && syncCalendar ? "*" : "(optionnel)"}
          <input
            type="time"
            name="scheduledTime"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
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
            onChange={(e) => setDurationMin(Number(e.target.value))}
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

      <SubmitButton className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
        {isCalendarMeeting && syncCalendar ? "Planifier & ajouter à l’agenda" : "Enregistrer"}
      </SubmitButton>
    </form>
  );
}
