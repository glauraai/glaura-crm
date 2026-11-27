import { describe, expect, it } from "vitest";
import { DEFAULT_SALES_AGENT_MODEL, stripJsonCodeFences } from "./llm";

describe("agents/llm helpers", () => {
  it("defaults to claude-haiku-5-5", () => {
    expect(DEFAULT_SALES_AGENT_MODEL).toBe("claude-haiku-5-5");
  });

  it("strips markdown json code fences cleanly", () => {
    expect(stripJsonCodeFences("```json\n{\"ok\":true}\n```")).toBe('{"ok":true}');
    expect(stripJsonCodeFences("  {\"a\":1}  ")).toBe('{"a":1}');
  });
});
