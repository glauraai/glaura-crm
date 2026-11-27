"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveSalon, restoreSalon } from "@/lib/actions";

export function ArchiveSalonButton({
  salonId,
  salonName,
  archived = false,
}: {
  salonId: string;
  salonName: string;
  archived?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    const prompt = archived
      ? `Restaurer « ${salonName} » dans le suivi commercial ?`
      : `Archiver « ${salonName} » ? Il disparaîtra du suivi commercial.`;
    if (!window.confirm(prompt)) return;

    startTransition(async () => {
      try {
        if (archived) {
          await restoreSalon(salonId);
          router.refresh();
        } else {
          await archiveSalon(salonId);
          router.push("/salons");
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "L’opération a échoué. Réessayez.");
      }
    });
  };

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleClick}
      className={
        archived
          ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          : "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
      }
    >
      {pending ? "…" : archived ? "Désarchiver" : "Archiver"}
    </button>
  );
}
