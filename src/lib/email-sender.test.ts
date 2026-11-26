import { afterEach, describe, expect, it, vi } from "vitest";
import { repSender } from "./email";

afterEach(() => vi.unstubAllEnvs());

describe("repSender", () => {
  it("sends as the rep when their address is on an authenticated domain", () => {
    expect(repSender({ email: "Tiago@Glaura.fr", name: "Tiago Barbeitos" })).toEqual({ name: "Tiago Barbeitos · Glaura", address: "tiago@glaura.fr" });
  });
  it("falls back to the default sender for other domains or no rep", () => {
    expect(repSender({ email: "someone@gmail.com", name: "X" })).toBeNull();
    expect(repSender({ email: "x@glaura.ai", name: "X" })).toBeNull();
    expect(repSender(null)).toBeNull();
    expect(repSender({ email: "" })).toBeNull();
  });
  it("honours REP_SENDER_DOMAINS", () => {
    vi.stubEnv("REP_SENDER_DOMAINS", "glaura.fr, glaura.ai");
    expect(repSender({ email: "x@glaura.ai", name: null })).toEqual({ name: "Glaura", address: "x@glaura.ai" });
  });
  it("strips characters that could break the From header", () => {
    expect(repSender({ email: "a@glaura.fr", name: 'Evil"\r\nBcc: x <y>' })?.name).toBe("Evil Bcc: x y · Glaura");
  });
});
