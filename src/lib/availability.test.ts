import { describe, expect, it } from "vitest";
import { dayBlocks, dayLabel, parisDay, parisTime, timeLabel, workingDays } from "./availability";

describe("Paris time helpers", () => {
  it("converts Paris wall-clock time across both offsets", () => {
    expect(parisTime("2026-11-26", 8).toISOString()).toBe("2026-11-26T07:00:00.000Z"); // winter UTC+1
    expect(parisTime("2026-07-01", 8).toISOString()).toBe("2026-07-01T06:00:00.000Z"); // summer UTC+2
    expect(parisTime("2026-11-26", 24).toISOString()).toBe("2026-11-26T23:00:00.000Z");
  });
  it("reads the Paris day of an instant", () => {
    expect(parisDay(new Date("2026-11-26T23:30:00Z"))).toBe("2026-11-27");
  });
  it("formats times the French way", () => {
    expect(timeLabel(new Date("2026-11-26T13:30:00Z"))).toBe("14h30");
  });
});

describe("workingDays", () => {
  it("skips weekends", () => {
    expect(workingDays(new Date("2026-11-26T10:00:00Z"), 5)).toEqual(["2026-11-26", "2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02"]);
  });
  it("starts on Monday when called on a weekend", () => {
    expect(workingDays(new Date("2026-11-28T10:00:00Z"), 1)).toEqual(["2026-11-30"]);
  });
});

describe("dayLabel", () => {
  it("says today, else a capitalised French date", () => {
    expect(dayLabel("2026-11-26", "2026-11-26")).toBe("Aujourd’hui");
    expect(dayLabel("2026-11-27", "2026-11-26")).toBe("Vendredi 27 nov.");
  });
});

describe("dayBlocks", () => {
  const at = (h: number, m = 0) => new Date(parisTime("2026-11-26", h).getTime() + m * 60_000);
  it("positions busy slots on the 8h–20h track", () => {
    const [block] = dayBlocks([{ start: at(14), end: at(15) }], "2026-11-26");
    expect(block.label).toBe("14h00–15h00");
    expect(block.left).toBeCloseTo(50);
    expect(block.width).toBeCloseTo(100 / 12);
  });
  it("merges overlaps, clips to the window and drops other days", () => {
    const blocks = dayBlocks([
      { start: at(7), end: at(9) },
      { start: at(10), end: at(11) },
      { start: at(10, 30), end: at(12, 15) },
      { start: parisTime("2026-11-27", 10), end: parisTime("2026-11-27", 11) },
    ], "2026-11-26");
    expect(blocks.map(b => b.label)).toEqual(["08h00–09h00", "10h00–12h15"]);
    expect(blocks[0].left).toBe(0);
  });
  it("returns nothing for a free day", () => {
    expect(dayBlocks([], "2026-11-26")).toEqual([]);
  });
});
