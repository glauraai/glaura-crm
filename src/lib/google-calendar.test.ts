import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
const subjects = vi.hoisted(() => [] as string[]);
vi.mock("google-auth-library", () => ({
  JWT: class { constructor(opts: { subject: string }) { subjects.push(opts.subject); } request = request; },
}));

const key = Buffer.from(JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: "-----BEGIN KEY-----" })).toString("base64");
const from = new Date("2026-11-26T00:00:00Z");
const to = new Date("2026-11-27T00:00:00Z");

beforeEach(() => { vi.resetModules(); request.mockReset(); subjects.length = 0; vi.unstubAllEnvs(); });

describe("getBusySlots", () => {
  it("is disabled without a service account key", async () => {
    const { calendarConfigured, getBusySlots } = await import("./google-calendar");
    expect(calendarConfigured()).toBe(false);
    expect((await getBusySlots(["a@glaura.fr"], from, to)).get("a@glaura.fr")).toEqual({ error: "not_configured" });
    expect(request).not.toHaveBeenCalled();
  });
  it("impersonates each rep, returns their busy slots and caches them", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_SA_KEY", key);
    request.mockImplementation(async ({ data }) => ({ data: { calendars: { [data.items[0].id]: { busy: [{ start: "2026-11-26T13:00:00Z", end: "2026-11-26T14:00:00Z" }] } } } }));
    const { getBusySlots } = await import("./google-calendar");
    const result = await getBusySlots(["Tiago@glaura.fr", "lea@glaura.fr"], from, to);
    expect(subjects).toEqual(["tiago@glaura.fr", "lea@glaura.fr"]);
    expect(result.get("tiago@glaura.fr")).toEqual({ busy: [{ start: new Date("2026-11-26T13:00:00Z"), end: new Date("2026-11-26T14:00:00Z") }] });
    await getBusySlots(["tiago@glaura.fr"], from, to);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("reports an unavailable calendar instead of throwing", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_SA_KEY", key);
    vi.spyOn(console, "error").mockImplementation(() => {});
    request.mockRejectedValue(new Error("unauthorized_client"));
    const { getBusySlots } = await import("./google-calendar");
    expect((await getBusySlots(["x@gmail.com"], from, to)).get("x@gmail.com")).toEqual({ error: "calendar_unavailable" });
  });
});
