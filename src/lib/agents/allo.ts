import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_TIMESTAMP_DRIFT_SEC = 300; // 5-minute replay window

export function verifyAlloSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  webhookId: string | null;
  secret: string;
  nowMs?: number;
}): boolean {
  const { rawBody, signature, timestamp, webhookId, secret, nowMs = Date.now() } = input;
  if (!signature || !timestamp || !secret.trim()) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - tsNum) > MAX_TIMESTAMP_DRIFT_SEC) return false;

  const signedContent = webhookId ? `${webhookId}.${timestamp}.${rawBody}` : `${timestamp}.${rawBody}`;
  const expectedB64 = createHmac("sha256", secret).update(signedContent).digest("base64");
  const expectedHex = createHmac("sha256", secret).update(signedContent).digest("hex");

  const candidates = signature
    .split(/\s+/)
    .flatMap((part) => (part.includes(",") ? [part.split(",").slice(1).join(",")] : [part]))
    .map((part) => part.replace(/^sha256=/i, "").trim())
    .filter(Boolean);

  for (const cand of candidates) {
    for (const expected of [expectedB64, expectedHex]) {
      const a = Buffer.from(cand);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  }
  return false;
}

export function parseAlloDurationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  let total = 0;
  let matched = false;
  const h = trimmed.match(/(\d+)\s*h/i);
  const m = trimmed.match(/(\d+)\s*m/i);
  const s = trimmed.match(/(\d+)\s*s/i);
  if (h) { total += Number(h[1]) * 3600; matched = true; }
  if (m) { total += Number(m[1]) * 60; matched = true; }
  if (s) { total += Number(s[1]); matched = true; }
  return matched ? total : null;
}

export type ParsedAlloEvent = {
  topic: string;
  externalId: string;
  occurredAt: Date;
  callDirection: "INBOUND" | "OUTBOUND" | null;
  callResult: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  prospectPhone: string | null;
  durationSec: number | null;
  summary: string | null;
  rawTranscript: string | null;
  recordingUrl: string | null;
};

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function parseAlloWebhook(payload: unknown): ParsedAlloEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const topic = strOrNull(root.topic);
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  if (!topic || !data) return null;

  const externalId = strOrNull(data.id);
  if (!externalId) return null;

  const rawType = strOrNull(data.type)?.toUpperCase();
  const callDirection = rawType === "INBOUND" || rawType === "OUTBOUND" ? rawType : null;
  const fromNumber = strOrNull(data.from_number) ?? strOrNull(data.from);
  const toNumber = strOrNull(data.to) ?? strOrNull(data.to_number);
  const prospectPhone = callDirection === "INBOUND" ? fromNumber : callDirection === "OUTBOUND" ? toNumber : (fromNumber ?? toNumber);

  const dateStr = strOrNull(data.start_date) ?? strOrNull(root.timestamp);
  const parsedDate = dateStr ? new Date(dateStr) : new Date();
  const occurredAt = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  let rawTranscript: string | null = null;
  if (typeof data.transcript === "string" && data.transcript.trim()) {
    rawTranscript = data.transcript.trim();
  } else if (Array.isArray(data.transcript)) {
    rawTranscript = data.transcript
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          const speaker = strOrNull(e.speaker) ?? strOrNull(e.role) ?? "";
          const text = strOrNull(e.text) ?? strOrNull(e.content) ?? "";
          return speaker ? `${speaker}: ${text}` : text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n") || null;
  }

  return {
    topic,
    externalId,
    occurredAt,
    callDirection,
    callResult: strOrNull(data.result)?.toUpperCase() ?? null,
    fromNumber,
    toNumber,
    prospectPhone,
    durationSec: parseAlloDurationSeconds(data.length ?? data.duration),
    summary: strOrNull(data.summary) ?? strOrNull(data.body),
    rawTranscript,
    recordingUrl: strOrNull(data.recording_url),
  };
}

export async function fetchAlloTranscript(callId: string): Promise<string | null> {
  const apiKey = process.env.ALLO_API_KEY?.trim();
  if (!apiKey) return null;
  const base = (process.env.ALLO_API_BASE_URL?.trim() || "https://api.withallo.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v2/api/conversations/items/search`, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: callId, limit: 1 }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ transcript?: string; text?: string }> };
    const first = data.items?.[0];
    return strOrNull(first?.transcript) ?? strOrNull(first?.text);
  } catch {
    return null;
  }
}
