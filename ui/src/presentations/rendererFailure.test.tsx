import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCard } from "../components/ToolCard";
import { codeSearchPresentation } from "./CodeSearchView";

describe("presentation failure containment", () => {
  it("A presentation cannot read its result: falls back to raw, logs the renderer failure, and preserves the conversation", () => {
    const failure = new Error("cannot render malformed search result");
    const output = "malformed search result retained verbatim";
    const renderer = vi.spyOn(codeSearchPresentation, "Expanded").mockImplementation(() => { throw failure; });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(<><p>Neighboring answer survives</p><ToolCard item={{ kind: "tool", toolCallId: "broken", toolName: "grep", args: { pattern: "needle" }, output }} /></>);
      expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
      expect(container.querySelector("pre")?.textContent).toBe(output);
      expect(screen.getByText("Neighboring answer survives")).toBeInTheDocument();
      expect(container.textContent).not.toContain(failure.message);
      expect(consoleError).toHaveBeenCalled();
      expect(consoleError.mock.calls.flat().some(value => value === failure || String(value).includes(failure.message))).toBe(true);
    } finally {
      renderer.mockRestore();
      consoleError.mockRestore();
    }
  });
});
