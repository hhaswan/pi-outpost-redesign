import { describe, expect, it } from "vitest";
import { sessionLabel } from "./sessionLabel";

describe("sessionLabel", () => {
  const child = { id: "01a1e665-d6e1-74c6", parentSession: "/p.jsonl", firstMessage: "" };

  it("keeps plain names and first messages of top-level sessions", () => {
    expect(sessionLabel({ id: "a", name: "Title", firstMessage: "Hello" })).toBe("Title");
    expect(sessionLabel({ id: "a", firstMessage: "Hello\nworld" })).toBe("Hello\nworld");
    expect(sessionLabel({ id: "a", firstMessage: "" })).toBe("(empty)");
  });

  it("joins a generated sub-agent name with the first line of its task", () => {
    expect(sessionLabel({ ...child, name: "general-purpose#57816f08", firstMessage: "Repo /root/x. Fix\nmore" })).toBe("general-purpose · Repo /root/x. Fix");
    expect(sessionLabel({ ...child, name: "general-purpose#57816f08" })).toBe("general-purpose#57816f08");
  });

  it("previews the first message, or falls back to a short id, for unnamed child sessions", () => {
    const long = "x".repeat(200);
    expect(sessionLabel({ ...child, firstMessage: `  ${long}\nnext` })).toBe(`${"x".repeat(79)}…`);
    expect(sessionLabel(child)).toBe("Sub-agent · 01a1e665");
  });
});
