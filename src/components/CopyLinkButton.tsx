"use client";

import { useState } from "react";

export function CopyLinkButton({ url, label = "Copier le lien" }: { url: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button type="button" onClick={copy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
      {state === "copied" ? "Lien copié ✓" : state === "failed" ? "Copie impossible" : label}
    </button>
  );
}
