import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseAlloDurationSeconds, parseAlloWebhook, verifyAlloSignature } from "./allo";
import { computeSuggestionDiff, parseEchoOutput } from "./echo";
import {
  DEFAULT_AI_MONTHLY_BUDGET_EUR,
  estimateAnthropicCostEur,
  extractUsageCostEur,
  isMonthlyAiBudgetExceeded,
} from "./budget";

describe("Allo (withallo.com) webhook & ECHO agent", () => {
  it("verifies Allo HMAC-SHA256 webhook signatures and rejects tampered payloads", () => {
    const secret = "whsec_test_secret_123";
    const ts = String(Math.floor(Date.now() / 1000));
    const id = "msg_01";
    const body = JSON.stringify({ topic: "call.completed", data: { id: "cll_1" } });
    const sig = createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("base64");

    expect(verifyAlloSignature({ rawBody: body, signature: `v1,${sig}`, timestamp: ts, webhookId: id, secret })).toBe(true);
    expect(verifyAlloSignature({ rawBody: body + "x", signature: `v1,${sig}`, timestamp: ts, webhookId: id, secret })).toBe(false);
    expect(verifyAlloSignature({ rawBody: body, signature: `v1,${sig}`, timestamp: "1000", webhookId: id, secret })).toBe(false);
  });

  it("parses Allo duration strings into seconds", () => {
    expect(parseAlloDurationSeconds("6m 12s")).toBe(372);
    expect(parseAlloDurationSeconds("1h 2m 5s")).toBe(3725);
    expect(parseAlloDurationSeconds("45s")).toBe(45);
    expect(parseAlloDurationSeconds(180)).toBe(180);
    expect(parseAlloDurationSeconds(null)).toBeNull();
  });

  it("normalizes Allo call.completed webhooks cleanly", () => {
    const parsed = parseAlloWebhook({
      topic: "call.completed",
      version: "2.0",
      timestamp: "2026-11-26T14:48:47.000Z",
      data: {
        id: "cll_7QhRk2",
        start_date: "2026-11-26T14:42:05.000Z",
        from_number: "+33612345678",
        to: "+33142000000",
        length: "3m 10s",
        type: "OUTBOUND",
        result: "ANSWERED",
        summary: "Gérante intéressée par Laura IA.",
        transcript: "Bonjour, je suis la gérante du salon...",
        recording_url: "https://storage.withallo.com/recordings/rc_1.mp3",
      },
    });

    expect(parsed).toMatchObject({
      externalId: "cll_7QhRk2",
      durationSec: 190,
      callDirection: "OUTBOUND",
      callResult: "ANSWERED",
      prospectPhone: "+33142000000",
      summary: "Gérante intéressée par Laura IA.",
    });
  });

  it("validates ECHO structured JSON and computes manager edit diffs", () => {
    const out = parseEchoOutput({
      isDecisionMakerCall: true,
      decisionMakerName: "Camille Dupont",
      decisionMakerRole: "Gérante",
      qualification: {
        salonSize: "3 postes",
        currentTool: "Planity",
        mainPain: "Appels manqués le soir",
        budget: "100 €/mois",
        salesAngle: "Messages et appels hors horaires (Laura IA)",
        productsPitched: ["Salon équipe", "Laura IA"],
      },
      proposedStage: "R1_PROGRAMME",
      objections: [{ category: "Déjà Planity", verbatim: "J'ai déjà Planity", responseGiven: "Sync agenda + Laura" }],
      nextStep: "Démo vendredi 14h",
      nextStepDate: "2026-11-28",
      generationReport: {
        actionsTaken: ["Extrait 6 champs de qualification"],
        assumptions: ["Gérante confirmée comme décideuse"],
        toVerify: ["Confirmer le nombre exact d'agendas"],
        sources: ["Allo call cll_7QhRk2"],
      },
    });
    expect(out.isDecisionMakerCall).toBe(true);
    expect(out.proposedStage).toBe("R1_PROGRAMME");

    const diff = computeSuggestionDiff(
      { proposedStage: "R1_PROGRAMME", nextStep: "Démo vendredi" },
      { proposedStage: "R1_EFFECTUE", nextStep: "Démo vendredi" },
    );
    expect(diff).toEqual([{ field: "proposedStage", before: "R1_PROGRAMME", after: "R1_EFFECTUE" }]);
  });

  it("enforces the 10 EUR per user per month Haiku AI budget cap", () => {
    expect(DEFAULT_AI_MONTHLY_BUDGET_EUR).toBe(10);
    const callCost = estimateAnthropicCostEur("claude-haiku-5-5", {
      inputTokens: 2000,
      outputTokens: 400,
      cacheReadTokens: 1000,
    });
    expect(callCost).toBeGreaterThan(0);
    expect(callCost).toBeLessThan(0.01);

    expect(extractUsageCostEur({ usage: { costEur: 0.0042 } })).toBe(0.0042);
    expect(extractUsageCostEur({})).toBe(0);

    expect(isMonthlyAiBudgetExceeded({ spentEur: 9.5, runsThisMonth: 500 }).exceeded).toBe(false);
    expect(isMonthlyAiBudgetExceeded({ spentEur: 10.0, runsThisMonth: 500 }).exceeded).toBe(true);
    expect(isMonthlyAiBudgetExceeded({ spentEur: 0.05, runsThisMonth: 10, maxRuns: 10 }).exceeded).toBe(true);
  });
});
