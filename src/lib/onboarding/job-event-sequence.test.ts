import { describe, expect, it, vi } from "vitest";
import { insertWithSequenceRetry } from "./job-event-sequence";

const uniqueViolation = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

describe("insertWithSequenceRetry", () => {
  it("inserts at the proposed sequence when it is free", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const reseed = vi.fn();

    await expect(insertWithSequenceRetry(5, insert, reseed)).resolves.toBe(5);
    expect(insert).toHaveBeenCalledWith(5);
    expect(reseed).not.toHaveBeenCalled();
  });

  it("re-reads the sequence and retries when another writer took the number", async () => {
    // e.g. a password reveal wrote seq 5 while the worker still thought 4 was the max
    const insert = vi.fn().mockRejectedValueOnce(uniqueViolation()).mockResolvedValue(undefined);
    const reseed = vi.fn().mockResolvedValue(6);

    await expect(insertWithSequenceRetry(5, insert, reseed)).resolves.toBe(6);
    expect(insert.mock.calls).toEqual([[5], [6]]);
  });

  it("rethrows errors that are not sequence collisions", async () => {
    const insert = vi.fn().mockRejectedValue(new Error("connection lost"));
    const reseed = vi.fn();

    await expect(insertWithSequenceRetry(5, insert, reseed)).rejects.toThrow("connection lost");
    expect(reseed).not.toHaveBeenCalled();
  });

  it("gives up after the maximum number of attempts", async () => {
    const insert = vi.fn().mockRejectedValue(uniqueViolation());
    const reseed = vi.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(7);

    await expect(insertWithSequenceRetry(5, insert, reseed)).rejects.toMatchObject({ code: "P2002" });
    expect(insert).toHaveBeenCalledTimes(3);
  });
});
