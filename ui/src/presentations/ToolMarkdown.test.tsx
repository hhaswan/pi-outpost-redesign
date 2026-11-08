import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCard } from "../components/ToolCard";

// Keep the real react-markdown and plugins: a text-only mock cannot prove this boundary.
describe("tool markdown safety", () => {
  it("A tool prints markdown containing raw HTML: renders markdown but leaves HTML inert and visible as text", () => {
    const html = '<script>alert(1)</script><img src=x onerror="alert(2)">';
    const output = JSON.stringify({ __pi_render: { text: `**Tool summary**\n\n${html}` } });
    const { container } = render(<ToolCard item={{ kind: "tool", toolCallId: "markdown", toolName: "custom", output }} />);
    expect(container.querySelector("strong")?.textContent).toBe("Tool summary");
    expect(container.textContent).toContain(html);
    expect(container.querySelector("script, img, [onerror]")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector("pre")?.textContent).toBe(output);
    expect(container.querySelector("script, img, [onerror]")).toBeNull();
  });
});
